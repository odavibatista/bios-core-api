import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import type { IbamaDump } from '../../domain/dtos/providers/ibama-dump.dto.js';

/**
 * Por quanto tempo os dumps baixados servem a coletas avulsas seguintes. Os
 * dumps mudam no máximo uma vez por dia; dez minutos bastam para uma rajada de
 * CNPJs distintos compartilhar um único download de ~330 MB (#262).
 */
export const IBAMA_DUMP_REUSE_MS = 10 * 60_000;

/** Dumps em uso, com o instante em que foram baixados. */
export interface LeasedIbamaDumps {
  dumps: readonly IbamaDump[];
  downloadedAt: Date;
  /** `true` quando os arquivos vieram de um download anterior. */
  reused: boolean;
}

/** Medição dos downloads, para provar o limite de um por vez. */
export interface IbamaDumpLeaseStats {
  downloads: number;
  reuses: number;
  activeDownloads: number;
  peakDownloads: number;
}

class HeldDumps {
  users = 0;
  retired = false;

  constructor(
    readonly dumps: readonly IbamaDump[],
    readonly downloadedAt: Date,
  ) {}

  async disposeIfUnused(): Promise<void> {
    if (this.retired && this.users === 0)
      await Promise.allSettled(this.dumps.map((dump) => dump.dispose()));
  }
}

/**
 * Guarda os dumps do IBAMA por alguns minutos e permite que coletas avulsas
 * seguidas, de CNPJs distintos, os reaproveitem em vez de baixar de novo.
 *
 * É também o ponto único do download: pedidos simultâneos esperam o mesmo
 * download em andamento (single-flight), então no máximo um acontece por vez.
 * O dono dos arquivos é a lease: quem usa não chama `dispose`. Os arquivos são
 * apagados quando expiram (e ninguém os lê), quando são substituídos ou no
 * encerramento da aplicação.
 */
@Injectable()
export class IbamaDumpLease implements OnModuleDestroy {
  private readonly logger = new Logger(IbamaDumpLease.name);
  private current: HeldDumps | null = null;
  private inFlight: Promise<HeldDumps> | null = null;
  private timer: NodeJS.Timeout | null = null;
  private reading: Promise<unknown> = Promise.resolve();

  readonly stats: IbamaDumpLeaseStats = {
    downloads: 0,
    reuses: 0,
    activeDownloads: 0,
    peakDownloads: 0,
  };

  /**
   * Executa `work` com os dumps vigentes, baixando-os com `download` só quando
   * não há um conjunto recente. `download` deve limpar o que já baixou se falhar.
   */
  async use<T>(
    download: () => Promise<IbamaDump[]>,
    work: (leased: LeasedIbamaDumps) => Promise<T>,
  ): Promise<T> {
    const { held, reused } = await this.acquire(download);
    try {
      // Os dumps têm um único cursor de leitura (`stats`, `records()`): leitores
      // do mesmo conjunto entram um de cada vez.
      const turn = this.reading.then(() =>
        work({ dumps: held.dumps, downloadedAt: held.downloadedAt, reused }),
      );
      this.reading = turn.catch(() => undefined);
      return await turn;
    } finally {
      held.users -= 1;
      await held.disposeIfUnused();
    }
  }

  /** Descarta o conjunto guardado (testes e encerramento). */
  async clear(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const held = this.current;
    this.current = null;
    if (held) await this.retire(held);
  }

  async onModuleDestroy(): Promise<void> {
    await this.clear();
  }

  private async acquire(
    download: () => Promise<IbamaDump[]>,
  ): Promise<{ held: HeldDumps; reused: boolean }> {
    const current = this.current;
    if (
      current &&
      Date.now() - current.downloadedAt.getTime() < IBAMA_DUMP_REUSE_MS
    ) {
      current.users += 1;
      this.stats.reuses += 1;
      this.logger.log(
        `Dumps do IBAMA reutilizados (baixados há ${Math.round((Date.now() - current.downloadedAt.getTime()) / 1000)} s).`,
      );
      return { held: current, reused: true };
    }

    if (this.inFlight) {
      const held = await this.inFlight;
      held.users += 1;
      this.stats.reuses += 1;
      return { held, reused: true };
    }

    const started = this.startDownload(download);
    this.inFlight = started;
    try {
      const held = await started;
      held.users += 1;
      return { held, reused: false };
    } finally {
      this.inFlight = null;
    }
  }

  private async startDownload(
    download: () => Promise<IbamaDump[]>,
  ): Promise<HeldDumps> {
    this.stats.activeDownloads += 1;
    this.stats.peakDownloads = Math.max(
      this.stats.peakDownloads,
      this.stats.activeDownloads,
    );
    try {
      const dumps = await download();
      this.stats.downloads += 1;
      const held = new HeldDumps(dumps, new Date());
      const previous = this.current;
      this.current = held;
      if (previous) await this.retire(previous);
      this.scheduleExpiry(held);
      this.logger.log(
        `Dumps do IBAMA baixados (${this.stats.downloads} download(s) desde o início).`,
      );
      return held;
    } finally {
      this.stats.activeDownloads -= 1;
    }
  }

  private scheduleExpiry(held: HeldDumps): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      if (this.current !== held) return;
      this.current = null;
      void this.retire(held);
    }, IBAMA_DUMP_REUSE_MS);
    this.timer.unref();
  }

  private async retire(held: HeldDumps): Promise<void> {
    held.retired = true;
    await held.disposeIfUnused();
  }
}

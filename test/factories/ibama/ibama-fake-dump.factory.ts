import type {
  IbamaDump,
  IbamaReadStats,
  IbamaRecord,
} from '@modules/ibama/domain/dtos/providers/ibama-dump.dto.js';
import { IbamaDiscardReason } from '@modules/ibama/domain/ibama-document.js';
import type { IbamaResource } from '@modules/ibama/domain/ibama-resource.js';
import { buildChecksum } from '../data-sources/ingestion-run.factory.js';
import { faker } from '../../support/faker.js';

/** Contagens de uma leitura sem nenhum descarte. */
export function buildReadStats(
  over: Partial<IbamaReadStats> = {},
): IbamaReadStats {
  const rows = over.rows ?? faker.number.int({ min: 10, max: 500 });

  return {
    rows,
    kept: rows,
    discarded: {
      [IbamaDiscardReason.PESSOA_FISICA]: 0,
      [IbamaDiscardReason.SEM_DOCUMENTO]: 0,
      [IbamaDiscardReason.DOCUMENTO_INVALIDO]: 0,
      [IbamaDiscardReason.REGISTRO_MALFORMADO]: 0,
    },
    ...over,
  };
}

/** Um dump já baixado, com `dispose` observável e o fluxo de registros que o teste escolher. */
export type FakeIbamaDump = IbamaDump & {
  dispose: ReturnType<typeof vi.fn<IbamaDump['dispose']>>;
  records: ReturnType<typeof vi.fn<IbamaDump['records']>>;

  /** O objeto que `records()` devolve: permite conferir quem o recebeu. */
  stream: AsyncGenerator<IbamaRecord>;
};

/**
 * Dump falso, sem arquivo algum: o que importa a quem o recebe é o checksum, as
 * contagens e o `dispose`. O fluxo de `records()` é sempre o mesmo objeto
 * (`stream`), vazio.
 */
export function buildFakeDump(
  resource: IbamaResource,
  over: Partial<Pick<IbamaDump, 'checksum' | 'stats' | 'bytes'>> = {},
): FakeIbamaDump {
  async function* empty(): AsyncGenerator<IbamaRecord> {
    await Promise.resolve();
    yield* [];
  }
  const stream = empty();

  return {
    resource,
    checksum: over.checksum ?? buildChecksum(),
    bytes: over.bytes ?? faker.number.int({ min: 1_000, max: 1_000_000 }),
    stats: over.stats ?? buildReadStats(),
    stream,
    records: vi.fn<IbamaDump['records']>(() => stream),
    dispose: vi.fn<IbamaDump['dispose']>().mockResolvedValue(),
  };
}

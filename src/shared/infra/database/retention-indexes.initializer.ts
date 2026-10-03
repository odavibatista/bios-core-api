import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { buildRetentionPolicies } from '../../config/data-retention.config.js';
import type { Environment } from '../../config/environment.config.js';
import { DatabaseHealthProvider } from '../../domain/providers/database-health.provider.js';
import { SyncRetentionIndexesUseCase } from '../usecases/data-retention/sync-retention-indexes.usecase.js';

/**
 * Sincroniza os índices TTL com as políticas de retenção configuradas, a cada
 * inicialização da aplicação.
 *
 * Roda em segundo plano: a API passa a aceitar requisições sem esperar o
 * banco. Com o banco indisponível, a sincronização é adiada para a próxima
 * inicialização com um único aviso; falhas pontuais por coleção são
 * registradas em log, sem derrubar a aplicação.
 *
 * Desativável por `DATA_RETENTION_SYNC_ON_BOOT=false` (ex.: testes, ou quando
 * a sincronização é feita por outro processo).
 */
@Injectable()
export class RetentionIndexesInitializer implements OnApplicationBootstrap {
  private readonly logger = new Logger(RetentionIndexesInitializer.name);

  constructor(
    private readonly configService: ConfigService<Environment, true>,
    private readonly databaseHealthProvider: DatabaseHealthProvider,
    private readonly syncRetentionIndexesUseCase: SyncRetentionIndexesUseCase,
  ) {}

  onApplicationBootstrap(): void {
    if (
      !this.configService.get('DATA_RETENTION_SYNC_ON_BOOT', { infer: true })
    ) {
      return;
    }

    void this.synchronize();
  }

  async synchronize(): Promise<void> {
    if (!(await this.databaseHealthProvider.isAvailable())) {
      this.logger.warn(
        'Banco de dados indisponível: sincronização dos índices de retenção ' +
          'adiada para a próxima inicialização.',
      );
      return;
    }

    const report = await this.syncRetentionIndexesUseCase.execute(
      buildRetentionPolicies(this.configService),
    );

    for (const { index, reason } of report.failed) {
      this.logger.error(`Retenção não aplicada em ${index}: ${reason}`);
    }

    this.logger.log(
      `Índices de retenção: ${report.created.length} criado(s), ` +
        `${report.updated.length} atualizado(s), ` +
        `${report.unchanged.length} inalterado(s), ` +
        `${report.failed.length} com falha.`,
    );
  }
}

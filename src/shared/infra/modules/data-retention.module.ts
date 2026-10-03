import { Module } from '@nestjs/common';
import { RetentionIndexProvider } from '../../domain/providers/retention-index.provider.js';
import { RetentionIndexesInitializer } from '../database/retention-indexes.initializer.js';
import { MongoRetentionIndexProvider } from '../providers/mongo-retention-index.provider.js';
import { SyncRetentionIndexesUseCase } from '../usecases/data-retention/sync-retention-indexes.usecase.js';

/**
 * Retenção de dados: mantém os índices TTL do MongoDB alinhados às políticas
 * configuradas por variáveis de ambiente (`DATA_RETENTION_*`).
 */
@Module({
  providers: [
    /* Providers */
    { provide: RetentionIndexProvider, useClass: MongoRetentionIndexProvider },

    /* Casos de uso */
    SyncRetentionIndexesUseCase,

    /* Inicialização */
    RetentionIndexesInitializer,
  ],
})
export class DataRetentionModule {}

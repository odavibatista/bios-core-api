import { Module } from '@nestjs/common';
import { DataSourceRepository } from '../../domain/dtos/repositories/data-source.repository.js';
import { PrismaDataSourceRepository } from '../db/repositories/prisma-data-source.repository.js';
import { ResolveSourceCacheTtlUseCase } from '../usecases/cache/resolve-source-cache-ttl.usecase.js';

/**
 * Catálogo de fontes externas, execuções de ingestão e log de requisições
 * às fontes (cadeia de fallback cadastral, rate limit, IA04).
 *
 * Entidades (schemas Prisma em `../../entity`): `DataSource`, `IngestionRun`, `DataSourceRequestLog`.
 *
 * Exporta a resolução da janela de cache: é o catálogo que define por quanto
 * tempo a consulta a cada fonte permanece válida (NFDE01), e quem publica no
 * cache pergunta aqui.
 */
@Module({
  providers: [
    /* Repositórios */
    { provide: DataSourceRepository, useClass: PrismaDataSourceRepository },

    /* Casos de uso */
    ResolveSourceCacheTtlUseCase,
  ],
  exports: [ResolveSourceCacheTtlUseCase],
})
export class DataSourcesModule {}

import { Module } from '@nestjs/common';
import { DataSourceRequestLogRepository } from '../../domain/dtos/repositories/data-source-request-log.repository.js';
import { DataSourceRepository } from '../../domain/dtos/repositories/data-source.repository.js';
import { SourceHttpClient } from '../../domain/providers/source-http-client.provider.js';
import { SourceRateLimiter } from '../../domain/providers/source-rate-limiter.provider.js';
import { PrismaDataSourceRequestLogRepository } from '../db/repositories/prisma-data-source-request-log.repository.js';
import { PrismaDataSourceRepository } from '../db/repositories/prisma-data-source.repository.js';
import { FetchSourceHttpClient } from '../providers/fetch-source-http-client.provider.js';
import { RedisSourceRateLimiter } from '../providers/redis-source-rate-limiter.provider.js';
import { ResolveSourceCacheTtlUseCase } from '../usecases/cache/resolve-source-cache-ttl.usecase.js';
import { ListCadastralChainUseCase } from '../usecases/chain/list-cadastral-chain.usecase.js';
import { ResolveEvidenceSourceUseCase } from '../usecases/evidence/resolve-evidence-source.usecase.js';
import { RequestDataSourceUseCase } from '../usecases/request/request-data-source.usecase.js';

/**
 * Catálogo de fontes externas, execuções de ingestão e log de requisições
 * às fontes (cadeia de fallback cadastral, rate limit, IA04).
 *
 * Entidades (schemas Prisma em `../../entity`): `DataSource`, `IngestionRun`, `DataSourceRequestLog`.
 *
 * Exporta o que os adapters das fontes (um módulo por fonte, NFPD02) usam:
 *  - `RequestDataSourceUseCase`: a chamada à fonte com limite por minuto,
 *    tempo máximo e log de requisições, tudo vindo do catálogo;
 *  - `ResolveSourceCacheTtlUseCase`: por quanto tempo a consulta a cada fonte
 *    permanece válida (NFDE01);
 *  - `ListCadastralChainUseCase`: a ordem da cadeia de fallback cadastral, que
 *    é do catálogo;
 *  - `ResolveEvidenceSourceUseCase`: a categoria e o ODS das evidências de uma
 *    fonte, também do catálogo (RF08).
 *
 * O contrato que os adapters implementam é `DataSourceInterface`
 * (`../../domain/data-source.interface.ts`).
 */
@Module({
  providers: [
    /* Repositórios */
    { provide: DataSourceRepository, useClass: PrismaDataSourceRepository },
    {
      provide: DataSourceRequestLogRepository,
      useClass: PrismaDataSourceRequestLogRepository,
    },

    /* Providers */
    { provide: SourceHttpClient, useClass: FetchSourceHttpClient },
    { provide: SourceRateLimiter, useClass: RedisSourceRateLimiter },

    /* Casos de uso */
    ResolveSourceCacheTtlUseCase,
    RequestDataSourceUseCase,
    ListCadastralChainUseCase,
    ResolveEvidenceSourceUseCase,
  ],
  exports: [
    ResolveSourceCacheTtlUseCase,
    RequestDataSourceUseCase,
    ListCadastralChainUseCase,
    ResolveEvidenceSourceUseCase,
  ],
})
export class DataSourcesModule {}

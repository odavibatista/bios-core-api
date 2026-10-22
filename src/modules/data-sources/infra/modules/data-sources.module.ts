import { Module } from '@nestjs/common';
import { DataSourceRequestLogRepository } from '../../domain/dtos/repositories/data-source-request-log.repository.js';
import { DataSourceRepository } from '../../domain/dtos/repositories/data-source.repository.js';
import { IngestionRunRepository } from '../../domain/dtos/repositories/ingestion-run.repository.js';
import { SourceHttpClient } from '../../domain/providers/source-http-client.provider.js';
import { SourceRateLimiter } from '../../domain/providers/source-rate-limiter.provider.js';
import { PrismaDataSourceRequestLogRepository } from '../db/repositories/prisma-data-source-request-log.repository.js';
import { PrismaDataSourceRepository } from '../db/repositories/prisma-data-source.repository.js';
import { PrismaIngestionRunRepository } from '../db/repositories/prisma-ingestion-run.repository.js';
import { FetchSourceHttpClient } from '../providers/fetch-source-http-client.provider.js';
import { RedisSourceRateLimiter } from '../providers/redis-source-rate-limiter.provider.js';
import { ResolveSourceCacheTtlUseCase } from '../usecases/cache/resolve-source-cache-ttl.usecase.js';
import { ListCadastralChainUseCase } from '../usecases/chain/list-cadastral-chain.usecase.js';
import { ResolveEvidenceSourceUseCase } from '../usecases/evidence/resolve-evidence-source.usecase.js';
import { FailIngestionRunUseCase } from '../usecases/ingestion/fail-ingestion-run.usecase.js';
import { FindLastConfirmedBatchUseCase } from '../usecases/ingestion/find-last-confirmed-batch.usecase.js';
import { FindLastSucceededIngestionRunUseCase } from '../usecases/ingestion/find-last-succeeded-ingestion-run.usecase.js';
import { FinishIngestionRunUseCase } from '../usecases/ingestion/finish-ingestion-run.usecase.js';
import { OpenIngestionRunUseCase } from '../usecases/ingestion/open-ingestion-run.usecase.js';
import { RequestDataSourceUseCase } from '../usecases/request/request-data-source.usecase.js';
import { ResolveSourceRequestConfigUseCase } from '../usecases/request/resolve-source-request-config.usecase.js';

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
 *    fonte, também do catálogo (RF08);
 *  - `OpenIngestionRunUseCase`, `FinishIngestionRunUseCase`,
 *    `FailIngestionRunUseCase` e `FindLastSucceededIngestionRunUseCase`: o
 *    registro das execuções de ingestão e a referência da última bem-sucedida
 *    (UC14).
 *
 * O contrato que os adapters implementam é `DataSourceInterface`
 * (`../../domain/data-source.interface.ts`).
 */
@Module({
  providers: [
    /* Repositórios */
    { provide: DataSourceRepository, useClass: PrismaDataSourceRepository },
    { provide: IngestionRunRepository, useClass: PrismaIngestionRunRepository },
    {
      provide: DataSourceRequestLogRepository,
      useClass: PrismaDataSourceRequestLogRepository,
    },

    /* Providers */
    { provide: SourceHttpClient, useClass: FetchSourceHttpClient },
    { provide: SourceRateLimiter, useClass: RedisSourceRateLimiter },

    /* Casos de uso */
    ResolveSourceRequestConfigUseCase,
    ResolveSourceCacheTtlUseCase,
    RequestDataSourceUseCase,
    ListCadastralChainUseCase,
    ResolveEvidenceSourceUseCase,
    OpenIngestionRunUseCase,
    FinishIngestionRunUseCase,
    FailIngestionRunUseCase,
    FindLastSucceededIngestionRunUseCase,
    FindLastConfirmedBatchUseCase,
  ],
  exports: [
    ResolveSourceRequestConfigUseCase,
    ResolveSourceCacheTtlUseCase,
    RequestDataSourceUseCase,
    ListCadastralChainUseCase,
    ResolveEvidenceSourceUseCase,
    OpenIngestionRunUseCase,
    FinishIngestionRunUseCase,
    FailIngestionRunUseCase,
    FindLastSucceededIngestionRunUseCase,
    FindLastConfirmedBatchUseCase,
  ],
})
export class DataSourcesModule {}

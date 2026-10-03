import { Module } from '@nestjs/common';

/**
 * Catálogo de fontes externas, execuções de ingestão e log de requisições
 * às fontes (cadeia de fallback cadastral, rate limit, IA04).
 *
 * Entidades (schemas Prisma em `../../entity`): `DataSource`, `IngestionRun`, `DataSourceRequestLog`.
 */
@Module({})
export class DataSourcesModule {}

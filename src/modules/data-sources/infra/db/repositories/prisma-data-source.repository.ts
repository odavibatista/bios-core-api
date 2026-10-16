import { Injectable } from '@nestjs/common';
import { PrismaRepository } from '@shared/infra/database/prisma.repository.js';
import { PrismaService } from '@shared/infra/database/prisma.service.js';
import type { DataSourceRequestConfig } from '../../../domain/dtos/providers/data-source-request.dto.js';
import { DataSourceRepository } from '../../../domain/dtos/repositories/data-source.repository.js';

/**
 * Catálogo de fontes externas no MongoDB.
 */
@Injectable()
export class PrismaDataSourceRepository
  extends PrismaRepository
  implements DataSourceRepository
{
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  async findCacheTtlSeconds(slug: string): Promise<number | null> {
    const source = await this.prisma.dataSource.findUnique({
      where: { slug },
      select: { cache_ttl_seconds: true },
    });

    return source?.cache_ttl_seconds ?? null;
  }

  async findRequestConfig(
    slug: string,
  ): Promise<DataSourceRequestConfig | null> {
    const source = await this.prisma.dataSource.findUnique({
      where: { slug },
      select: {
        id_data_source: true,
        slug: true,
        base_url: true,
        is_enabled: true,
        rate_limit_per_minute: true,
        request_timeout_ms: true,
      },
    });

    return source
      ? {
          id: source.id_data_source,
          slug: source.slug,
          baseUrl: source.base_url,
          isEnabled: source.is_enabled,
          rateLimitPerMinute: source.rate_limit_per_minute,
          requestTimeoutMs: source.request_timeout_ms,
        }
      : null;
  }
}

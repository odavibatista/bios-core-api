import { Injectable } from '@nestjs/common';
import { PrismaRepository } from '@shared/infra/database/prisma.repository.js';
import { PrismaService } from '@shared/infra/database/prisma.service.js';
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
}

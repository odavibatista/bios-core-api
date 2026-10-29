import { Injectable } from '@nestjs/common';
import { PrismaRepository } from '@shared/infra/database/prisma.repository.js';
import { PrismaService } from '@shared/infra/database/prisma.service.js';
import {
  HoneypotHitRepository,
  type NewHoneypotHit,
} from '../../../domain/dtos/repositories/honeypot-hit.repository.js';

/**
 * Chamadas a endpoints isca no MongoDB. Removidas pela retenção
 * (`DATA_RETENTION_HONEYPOT_HITS`, índice TTL em `hit_at`).
 */
@Injectable()
export class PrismaHoneypotHitRepository
  extends PrismaRepository
  implements HoneypotHitRepository
{
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  async record({
    ip,
    endpoint,
    httpMethod,
    userAgent,
  }: NewHoneypotHit): Promise<void> {
    await this.prisma.honeypotHit.create({
      data: { ip, endpoint, http_method: httpMethod, user_agent: userAgent },
    });
  }
}

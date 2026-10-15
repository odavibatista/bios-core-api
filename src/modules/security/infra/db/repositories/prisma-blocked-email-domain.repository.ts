import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaRepository } from '@shared/infra/database/prisma.repository.js';
import { PrismaService } from '@shared/infra/database/prisma.service.js';
import { BlockedEmailDomainRepository } from '../../../domain/dtos/repositories/blocked-email-domain.repository.js';

/**
 * Domínio não removido logicamente.
 *
 * `deleted_at: null` sozinho não basta no MongoDB: o campo omitido na criação
 * (como faz o seeder) fica ausente do documento, e o Prisma só casa `null` com
 * valor explícito. Sem tratar a ausência, os domínios semeados nunca seriam
 * bloqueados.
 */
const NOT_DELETED = {
  OR: [{ deleted_at: null }, { deleted_at: { isSet: false } }],
} satisfies Prisma.BlockedEmailDomainWhereInput;

/**
 * Blacklist de domínios de e-mail no MongoDB.
 *
 * A consulta vai ao banco a cada chamada, sem cache: incluir ou remover um
 * domínio precisa valer na consulta seguinte, sem novo deploy (RF22, RF29).
 * O índice único em `domain` mantém o custo constante.
 */
@Injectable()
export class PrismaBlockedEmailDomainRepository
  extends PrismaRepository
  implements BlockedEmailDomainRepository
{
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  async isBlocked(domain: string): Promise<boolean> {
    const blocked = await this.prisma.blockedEmailDomain.findFirst({
      where: { domain, ...NOT_DELETED },
      select: { id_blocked_email_domain: true },
    });

    return blocked !== null;
  }
}

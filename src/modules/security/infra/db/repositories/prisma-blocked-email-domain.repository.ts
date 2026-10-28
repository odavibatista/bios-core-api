import { Injectable } from '@nestjs/common';
import { BlockedDomainOrigin, Prisma } from '@prisma/client';
import { PrismaRepository } from '@shared/infra/database/prisma.repository.js';
import { PrismaService } from '@shared/infra/database/prisma.service.js';
import {
  type AddBlockedEmailDomainResult,
  type BlockedEmailDomainRecord,
  BlockedEmailDomainRepository,
} from '../../../domain/dtos/repositories/blocked-email-domain.repository.js';

/** Código do Prisma para violação de índice único. */
const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

/** Campos devolvidos ao administrador. */
const RECORD_FIELDS = {
  id_blocked_email_domain: true,
  domain: true,
  origin: true,
  created_at: true,
} satisfies Prisma.BlockedEmailDomainSelect;

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

  async listActive({
    skip,
    take,
  }: {
    skip: number;
    take: number;
  }): Promise<{ items: BlockedEmailDomainRecord[]; total: number }> {
    const [rows, total] = await Promise.all([
      this.prisma.blockedEmailDomain.findMany({
        where: NOT_DELETED,
        orderBy: { domain: 'asc' },
        skip,
        take,
        select: RECORD_FIELDS,
      }),
      this.prisma.blockedEmailDomain.count({ where: NOT_DELETED }),
    ]);

    return { items: rows.map(toRecord), total };
  }

  async add(
    domain: string,
    createdByUserId: string,
  ): Promise<AddBlockedEmailDomainResult> {
    const existing = await this.prisma.blockedEmailDomain.findUnique({
      where: { domain },
      select: { id_blocked_email_domain: true, deleted_at: true },
    });

    if (existing) {
      if (!existing.deleted_at) return { outcome: 'ALREADY_BLOCKED' };

      // Condicionada a ainda estar removido: de duas reinclusões simultâneas, só uma
      // restaura; a outra encontra o domínio já bloqueado.
      const { count } = await this.prisma.blockedEmailDomain.updateMany({
        where: {
          id_blocked_email_domain: existing.id_blocked_email_domain,
          deleted_at: { not: null },
        },
        data: {
          deleted_at: null,
          origin: BlockedDomainOrigin.ADMIN,
          created_by_user_id: createdByUserId,
        },
      });

      if (count === 0) return { outcome: 'ALREADY_BLOCKED' };

      const restored = await this.prisma.blockedEmailDomain.findUniqueOrThrow({
        where: { id_blocked_email_domain: existing.id_blocked_email_domain },
        select: RECORD_FIELDS,
      });

      return { outcome: 'RESTORED', record: toRecord(restored) };
    }

    try {
      const created = await this.prisma.blockedEmailDomain.create({
        data: {
          domain,
          origin: BlockedDomainOrigin.ADMIN,
          created_by_user_id: createdByUserId,
        },
        select: RECORD_FIELDS,
      });

      return { outcome: 'ADDED', record: toRecord(created) };
    } catch (error) {
      // Outra inclusão do mesmo domínio chegou primeiro (índice único em `domain`).
      if (isUniqueViolation(error)) return { outcome: 'ALREADY_BLOCKED' };

      throw error;
    }
  }

  async remove(id: string, removedAt: Date): Promise<boolean> {
    const { count } = await this.prisma.blockedEmailDomain.updateMany({
      where: { id_blocked_email_domain: id, ...NOT_DELETED },
      data: { deleted_at: removedAt },
    });

    return count === 1;
  }
}

function toRecord(
  row: Prisma.BlockedEmailDomainGetPayload<{ select: typeof RECORD_FIELDS }>,
): BlockedEmailDomainRecord {
  return {
    id: row.id_blocked_email_domain,
    domain: row.domain,
    origin: row.origin,
    createdAt: row.created_at,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === UNIQUE_CONSTRAINT_VIOLATION
  );
}

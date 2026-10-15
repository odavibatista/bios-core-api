import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaRepository } from '@shared/infra/database/prisma.repository.js';
import { PrismaService } from '@shared/infra/database/prisma.service.js';
import {
  type ActiveApiKey,
  ApiKeyRepository,
  type NewApiKey,
} from '../../../domain/dtos/repositories/api-key.repository.js';

/** Código do Prisma para violação de índice único. */
const UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

/**
 * Chave ainda não revogada.
 *
 * `revoked_at: null` sozinho não basta no MongoDB: o campo omitido na criação
 * fica ausente do documento, e o Prisma só casa `null` com valor explícito.
 * Sem tratar a ausência, nenhuma chave recém-gerada seria encontrada.
 */
const NOT_REVOKED = {
  OR: [{ revoked_at: null }, { revoked_at: { isSet: false } }],
} satisfies Prisma.ApiKeyWhereInput;

const ACTIVE_KEY_FIELDS = {
  id_api_key: true,
  key_name: true,
  key_prefix: true,
  created_at: true,
  last_used_at: true,
} satisfies Prisma.ApiKeySelect;

function toActiveApiKey(
  key: Prisma.ApiKeyGetPayload<{ select: typeof ACTIVE_KEY_FIELDS }>,
): ActiveApiKey {
  return {
    id: key.id_api_key,
    name: key.key_name,
    prefix: key.key_prefix,
    createdAt: key.created_at,
    lastUsedAt: key.last_used_at,
  };
}

/**
 * Chaves de API no MongoDB.
 *
 * Só o resumo SHA-256 é gravado; o valor completo existe apenas na resposta da
 * geração (NFSE01). Os campos da chave que a listagem devolve não incluem o
 * resumo.
 */
@Injectable()
export class PrismaApiKeyRepository
  extends PrismaRepository
  implements ApiKeyRepository
{
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  async create({
    userId,
    name,
    prefix,
    hash,
  }: NewApiKey): Promise<ActiveApiKey | null> {
    try {
      const key = await this.prisma.apiKey.create({
        data: {
          user_id: userId,
          key_name: name,
          key_prefix: prefix,
          key_hash: hash,
        },
        select: ACTIVE_KEY_FIELDS,
      });

      return toActiveApiKey(key);
    } catch (error) {
      if (isUniqueViolation(error)) return null;

      throw error;
    }
  }

  countActive(userId: string): Promise<number> {
    return this.prisma.apiKey.count({
      where: { user_id: userId, ...NOT_REVOKED },
    });
  }

  async listActive(userId: string): Promise<ActiveApiKey[]> {
    const keys = await this.prisma.apiKey.findMany({
      where: { user_id: userId, ...NOT_REVOKED },
      orderBy: { created_at: 'desc' },
      select: ACTIVE_KEY_FIELDS,
    });

    return keys.map(toActiveApiKey);
  }

  async revoke(
    userId: string,
    apiKeyId: string,
    revokedAt: Date,
  ): Promise<boolean> {
    const { count } = await this.prisma.apiKey.updateMany({
      where: { id_api_key: apiKeyId, user_id: userId, ...NOT_REVOKED },
      data: { revoked_at: revokedAt },
    });

    return count === 1;
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === UNIQUE_CONSTRAINT_VIOLATION
  );
}

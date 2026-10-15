import { Injectable } from '@nestjs/common';
import { UseCase } from '@shared/domain/protocols/use-case.protocol.js';
import { ApiKeyRepository } from '../../domain/dtos/repositories/api-key.repository.js';
import type { ApiKeyListResponse } from '../../domain/dtos/requests/api-key.dto.js';

/**
 * Lista as chaves de API ativas do usuário (UC11, regra de negócio 2).
 *
 * Cada item traz nome, prefixo, data de criação e data do último uso — o
 * identificador só serve para revogar. O valor completo da chave e o seu resumo
 * não existem aqui: não há como reexibir uma chave depois da geração (NFSE01).
 * Chaves revogadas não aparecem.
 */
@Injectable()
export class ListApiKeysUseCase extends UseCase<string, ApiKeyListResponse> {
  constructor(private readonly apiKeyRepository: ApiKeyRepository) {
    super();
  }

  override async execute(userId: string): Promise<ApiKeyListResponse> {
    const keys = await this.apiKeyRepository.listActive(userId);

    return {
      data: keys.map(({ id, name, prefix, createdAt, lastUsedAt }) => ({
        id,
        name,
        prefix,
        created_at: createdAt.toISOString(),
        last_used_at: lastUsedAt?.toISOString() ?? null,
      })),
    };
  }
}

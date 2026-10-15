import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '@shared/domain/dtos/authenticated-user.dto.js';
import { UseCase } from '@shared/domain/protocols/use-case.protocol.js';
import { OpaqueTokenProvider } from '@shared/domain/providers/opaque-token.provider.js';
import {
  API_KEY_PUBLIC_ID_LENGTH,
  apiKeyPrefixOf,
  buildApiKey,
} from '../../domain/api-key-format.js';
import { ApiKeyLimitReachedException } from '../../domain/dtos/errors/api-key-limit-reached.exception.js';
import { ApiKeyRepository } from '../../domain/dtos/repositories/api-key.repository.js';
import type {
  CreateApiKeyRequest,
  CreatedApiKeyResponse,
} from '../../domain/dtos/requests/api-key.dto.js';

/** Teto de chaves ativas por usuário. */
export const MAX_ACTIVE_API_KEYS_PER_USER = 10;

/** Tentativas de achar um prefixo livre antes de desistir. */
const MAX_GENERATION_ATTEMPTS = 3;

/** Quem gera a chave e o nome que escolheu. */
export interface CreateApiKeyCommand {
  user: AuthenticatedUser;
  request: CreateApiKeyRequest;
}

/**
 * Gera uma chave de API para o usuário (UC11, RF16, NFSE01).
 *
 * A chave é `bios_<identificador>_<segredo>`, com o segredo de 256 bits
 * aleatórios. **Só o resumo SHA-256 da chave completa é gravado**; o valor
 * completo está na resposta desta chamada e em nenhum outro lugar — nem no
 * banco, nem em log. Perdê-lo exige gerar outra chave.
 *
 * O identificador público (8 caracteres) é sorteado, e a unicidade é do banco:
 * numa colisão — improvável — gera-se outro, até três vezes.
 *
 * @throws {ApiKeyLimitReachedException} quando o usuário já tem o máximo de chaves ativas.
 */
@Injectable()
export class CreateApiKeyUseCase extends UseCase<
  CreateApiKeyCommand,
  CreatedApiKeyResponse
> {
  constructor(
    private readonly apiKeyRepository: ApiKeyRepository,
    private readonly opaqueTokenProvider: OpaqueTokenProvider,
  ) {
    super();
  }

  override async execute({
    user,
    request,
  }: CreateApiKeyCommand): Promise<CreatedApiKeyResponse> {
    const active = await this.apiKeyRepository.countActive(user.userId);

    if (active >= MAX_ACTIVE_API_KEYS_PER_USER) {
      throw new ApiKeyLimitReachedException(MAX_ACTIVE_API_KEYS_PER_USER);
    }

    for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt += 1) {
      const publicId = this.newPublicId();
      const key = buildApiKey(
        publicId,
        this.opaqueTokenProvider.generate().token,
      );

      const created = await this.apiKeyRepository.create({
        userId: user.userId,
        name: request.name,
        prefix: apiKeyPrefixOf(publicId),
        hash: this.opaqueTokenProvider.hash(key),
      });

      if (created) {
        return {
          id: created.id,
          name: created.name,
          prefix: created.prefix,
          created_at: created.createdAt.toISOString(),
          last_used_at: null,
          key,
        };
      }
    }

    throw new Error(
      'Não foi possível gerar um identificador único de chave de API.',
    );
  }

  /** Identificador público: alfanumérico, tirado de um token aleatório. */
  private newPublicId(): string {
    return this.opaqueTokenProvider
      .generate()
      .token.replace(/[-_]/g, '')
      .slice(0, API_KEY_PUBLIC_ID_LENGTH);
  }
}

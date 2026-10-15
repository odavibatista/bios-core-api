import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '@shared/domain/dtos/authenticated-user.dto.js';
import { UseCase } from '@shared/domain/protocols/use-case.protocol.js';
import { ApiKeyNotFoundException } from '../../domain/dtos/errors/api-key-not-found.exception.js';
import { ApiKeyRepository } from '../../domain/dtos/repositories/api-key.repository.js';

/** Identificador do MongoDB: 24 caracteres hexadecimais. */
const OBJECT_ID_PATTERN = /^[0-9a-f]{24}$/i;

/** Quem revoga e qual chave. */
export interface RevokeApiKeyCommand {
  user: AuthenticatedUser;
  apiKeyId: string;
}

/**
 * Revoga uma chave de API do usuário, com efeito imediato (UC11, fluxo 2.1).
 *
 * A posse faz parte da própria escrita: o identificador de uma chave de outra
 * pessoa não revoga nada e responde igual a um identificador que não existe.
 * Revogar uma chave já revogada também responde "não encontrada".
 *
 * @throws {ApiKeyNotFoundException} quando a chave não existe, já foi revogada
 * ou é de outro usuário.
 */
@Injectable()
export class RevokeApiKeyUseCase extends UseCase<RevokeApiKeyCommand, void> {
  constructor(private readonly apiKeyRepository: ApiKeyRepository) {
    super();
  }

  override async execute({
    user,
    apiKeyId,
  }: RevokeApiKeyCommand): Promise<void> {
    // Um identificador malformado nem chega ao banco, que o recusaria com erro.
    if (!OBJECT_ID_PATTERN.test(apiKeyId)) throw new ApiKeyNotFoundException();

    const revoked = await this.apiKeyRepository.revoke(
      user.userId,
      apiKeyId,
      new Date(),
    );

    if (!revoked) throw new ApiKeyNotFoundException();
  }
}

import { Injectable } from '@nestjs/common';
import { UseCase } from '@shared/domain/protocols/use-case.protocol.js';
import { BlockedEmailDomainNotFoundException } from '../../domain/dtos/errors/blocked-email-domain-admin.errors.js';
import { BlockedEmailDomainRepository } from '../../domain/dtos/repositories/blocked-email-domain.repository.js';

/** Identificador do MongoDB: 24 caracteres hexadecimais. */
const OBJECT_ID_PATTERN = /^[0-9a-f]{24}$/i;

/**
 * Remove um domínio da blacklist (UC13, fluxo 3.1): remoção lógica, com efeito imediato.
 * O registro fica, para que uma reinclusão o restaure (RF29).
 *
 * Identificador malformado, inexistente ou já removido respondem igual (`404`).
 */
@Injectable()
export class RemoveBlockedEmailDomainUseCase extends UseCase<string, void> {
  constructor(private readonly repository: BlockedEmailDomainRepository) {
    super();
  }

  override async execute(id: string): Promise<void> {
    if (!OBJECT_ID_PATTERN.test(id)) {
      throw new BlockedEmailDomainNotFoundException();
    }

    if (!(await this.repository.remove(id, new Date()))) {
      throw new BlockedEmailDomainNotFoundException();
    }
  }
}

import { HttpStatus } from '@nestjs/common';
import { DomainException } from '@shared/domain/errors/domain.exception.js';

/**
 * O usuário já tem o máximo de chaves de API ativas (UC11).
 *
 * Revogar uma chave libera uma vaga. O teto existe para que uma conta não
 * acumule chaves sem fim: cada uma é um segredo válido a mais para vazar e uma
 * linha a mais no banco.
 */
export class ApiKeyLimitReachedException extends DomainException {
  constructor(limit: number) {
    super(
      'API_KEY_LIMIT_REACHED',
      `Você já tem ${limit} chaves de API ativas. Revogue uma para gerar outra.`,
      HttpStatus.UNPROCESSABLE_ENTITY,
      { limit },
    );
  }
}

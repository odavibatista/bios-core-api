import { HttpStatus } from '@nestjs/common';
import { DomainException } from '@shared/domain/errors/domain.exception.js';

/**
 * O IP foi bloqueado sem prazo por chamar um endpoint isca (RF21) e é recusado em qualquer
 * rota. A mensagem não diz o motivo nem como sair: é para robôs de raspagem.
 */
export class IpBlockedException extends DomainException {
  constructor() {
    super('ACCESS_BLOCKED', 'Acesso bloqueado.', HttpStatus.FORBIDDEN);
  }
}

import { HttpStatus } from '@nestjs/common';
import { DomainException } from './domain.exception.js';

/**
 * Falha ao cifrar ou decifrar um dado sensível (NFSE03).
 *
 * Indica texto adulterado, truncado, cifrado com uma versão de chave que não
 * está configurada, ou qualquer outra quebra de integridade detectada pelo
 * modo autenticado do AES-GCM. Nunca carrega o valor envolvido: a mensagem é
 * genérica, e o motivo real fica apenas em `details.reason`, para log.
 */
export class EncryptionException extends DomainException {
  constructor(reason: string) {
    super(
      'ENCRYPTION_FAILED',
      'Não foi possível processar um dado protegido.',
      HttpStatus.INTERNAL_SERVER_ERROR,
      { reason },
    );
  }
}

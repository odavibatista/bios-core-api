import { HttpStatus } from '@nestjs/common';
import { DomainException } from '@shared/domain/errors/domain.exception.js';

/** O CEP é válido, mas não existe (RF39). */
export class PostalCodeNotFoundException extends DomainException {
  constructor() {
    super(
      'POSTAL_CODE_NOT_FOUND',
      'CEP não encontrado. Confira os dígitos ou preencha o endereço à mão.',
      HttpStatus.NOT_FOUND,
    );
  }
}

/** A fonte do CEP não respondeu: o endereço continua podendo ser preenchido à mão (RF39). */
export class PostalCodeLookupUnavailableException extends DomainException {
  constructor() {
    super(
      'POSTAL_CODE_LOOKUP_UNAVAILABLE',
      'Não foi possível consultar o CEP agora. Preencha o endereço à mão.',
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
}

/** O código informado não é de um município da UF selecionada (RF38). */
export class CityNotInStateException extends DomainException {
  constructor() {
    super(
      'CITY_NOT_IN_STATE',
      'O município informado não pertence à UF selecionada.',
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}

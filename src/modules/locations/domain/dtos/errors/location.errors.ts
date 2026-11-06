import { HttpStatus } from '@nestjs/common';
import { DomainException } from '@shared/domain/errors/domain.exception.js';

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

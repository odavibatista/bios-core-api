import { Injectable } from '@nestjs/common';
import { UseCase } from '@shared/domain/protocols/use-case.protocol.js';
import { CityNotInStateException } from '../../domain/dtos/errors/location.errors.js';
import {
  type CityRecord,
  LocationRepository,
} from '../../domain/dtos/repositories/location.repository.js';

/** Município escolhido: código IBGE e UF em que ele foi selecionado. */
export interface ResolveCityCommand {
  ibgeCode: string;
  uf: string;
}

/**
 * Confere um município escolhido na UF selecionada e devolve o registro do catálogo (RF38).
 *
 * @throws {CityNotInStateException} quando o código não é de um município da UF (422).
 */
@Injectable()
export class ResolveCityUseCase extends UseCase<
  ResolveCityCommand,
  CityRecord
> {
  constructor(private readonly locations: LocationRepository) {
    super();
  }

  override async execute({
    ibgeCode,
    uf,
  }: ResolveCityCommand): Promise<CityRecord> {
    const city = await this.locations.findCity(Number(ibgeCode), uf);

    if (!city) throw new CityNotInStateException();

    return city;
  }
}

import { Injectable } from '@nestjs/common';
import { UseCase } from '@shared/domain/protocols/use-case.protocol.js';
import { LocationRepository } from '../../domain/dtos/repositories/location.repository.js';
import type { IbgeStateListResponse } from '../../domain/dtos/requests/location.dto.js';

/** As 27 UFs, para montar o seletor (RF38). */
@Injectable()
export class ListStatesUseCase extends UseCase<void, IbgeStateListResponse> {
  constructor(private readonly locations: LocationRepository) {
    super();
  }

  override async execute(): Promise<IbgeStateListResponse> {
    const states = await this.locations.listStates();

    return {
      data: states.map(({ ibgeCode, acronym, name }) => ({
        ibge_code: String(ibgeCode),
        acronym,
        name,
      })),
    };
  }
}

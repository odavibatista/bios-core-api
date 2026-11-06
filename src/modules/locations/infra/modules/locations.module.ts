import { Module } from '@nestjs/common';
import { DataSourcesModule } from '@modules/data-sources/infra/modules/data-sources.module.js';
import { ViaCepModule } from '@modules/viacep/infra/modules/viacep.module.js';
import { LocationRepository } from '../../domain/dtos/repositories/location.repository.js';
import { LocationsController } from '../../http/controllers/locations.controller.js';
import { PrismaLocationRepository } from '../db/repositories/prisma-location.repository.js';
import { ListCitiesUseCase } from '../usecases/list-cities.usecase.js';
import { ListStatesUseCase } from '../usecases/list-states.usecase.js';
import { LookupPostalCodeUseCase } from '../usecases/lookup-postal-code.usecase.js';
import { ResolveCityUseCase } from '../usecases/resolve-city.usecase.js';

/**
 * UFs e municípios do IBGE, em disco (RF38), e endereço pelo CEP (RF39). Exporta
 * `ResolveCityUseCase` para quem recebe um município escolhido conferir a UF dele.
 *
 * Entidades (schemas Prisma em `../../entity`): `IbgeState`, `IbgeCity`.
 */
@Module({
  imports: [DataSourcesModule, ViaCepModule],
  controllers: [LocationsController],
  providers: [
    { provide: LocationRepository, useClass: PrismaLocationRepository },
    ListStatesUseCase,
    ListCitiesUseCase,
    LookupPostalCodeUseCase,
    ResolveCityUseCase,
  ],
  exports: [ResolveCityUseCase],
})
export class LocationsModule {}

import { Module } from '@nestjs/common';
import { SecurityModule } from '@modules/security/infra/modules/security.module.js';
import { DecoyCompanyGenerator } from '../../domain/decoy-company.generator.js';
import { DecoyCompaniesController } from '../../http/controllers/decoy-companies.controller.js';
import {
  DECOY_RANDOM,
  DecoyAvailability,
} from '../providers/decoy-availability.js';
import {
  GetDecoyCompanyUseCase,
  ListDecoyCompaniesUseCase,
} from '../usecases/decoy-companies.usecases.js';

/**
 * Endpoints isca (RF21, NFSE07, #88), em módulo próprio e isolado: não lê o banco nem as
 * fontes, e a indisponibilidade simulada vale só aqui. O registro do acesso e o bloqueio do
 * IP vêm do `SecurityModule` (`@Honeypot()`, #87).
 */
@Module({
  imports: [SecurityModule],
  controllers: [DecoyCompaniesController],
  providers: [
    { provide: DecoyCompanyGenerator, useValue: new DecoyCompanyGenerator() },
    { provide: DECOY_RANDOM, useValue: Math.random },
    DecoyAvailability,
    ListDecoyCompaniesUseCase,
    GetDecoyCompanyUseCase,
  ],
})
export class HoneypotModule {}

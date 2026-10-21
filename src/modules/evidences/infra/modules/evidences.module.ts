import { Module } from '@nestjs/common';
import { DataSourcesModule } from '@modules/data-sources/infra/modules/data-sources.module.js';
import { EvidenceRepository } from '../../domain/dtos/repositories/evidence.repository.js';
import { PrismaEvidenceRepository } from '../db/repositories/prisma-evidence.repository.js';
import { ListCompanyEvidencesUseCase } from '../usecases/list-company-evidences.usecase.js';
import { RecordEvidenceCollectionUseCase } from '../usecases/record-evidence-collection.usecase.js';

/**
 * Camadas bruta e normalizada de evidências ambientais por CNPJ
 * (UC07, UC14; RF07–RF09).
 *
 * Entidades (schemas Prisma em `../../entity`): `EvidenceRaw`, `EvidenceNormalized`.
 *
 * Exporta o que as fontes de evidência e o perfil ambiental usam:
 *  - `RecordEvidenceCollectionUseCase`: grava o resultado de consultar uma
 *    fonte para um CNPJ, de forma idempotente, com categoria, ODS e validade
 *    vindos do catálogo (RF08);
 *  - `ListCompanyEvidencesUseCase`: as evidências de uma empresa com o estado
 *    de agora (`OUTDATED` derivado da validade).
 */
@Module({
  imports: [DataSourcesModule],
  providers: [
    /* Repositórios */
    { provide: EvidenceRepository, useClass: PrismaEvidenceRepository },

    /* Casos de uso */
    RecordEvidenceCollectionUseCase,
    ListCompanyEvidencesUseCase,
  ],
  exports: [RecordEvidenceCollectionUseCase, ListCompanyEvidencesUseCase],
})
export class EvidencesModule {}

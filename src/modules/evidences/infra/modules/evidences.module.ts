import { Module } from '@nestjs/common';
import { DataSourcesModule } from '@modules/data-sources/infra/modules/data-sources.module.js';
import { EvidenceRepository } from '../../domain/dtos/repositories/evidence.repository.js';
import { RawEvidenceRepository } from '../../domain/dtos/repositories/raw-evidence.repository.js';
import { PrismaEvidenceRepository } from '../db/repositories/prisma-evidence.repository.js';
import { PrismaRawEvidenceRepository } from '../db/repositories/prisma-raw-evidence.repository.js';
import { ListCompanyEvidencesUseCase } from '../usecases/list-company-evidences.usecase.js';
import { OpenEvidenceBatchUseCase } from '../usecases/open-evidence-batch.usecase.js';
import { RecordEvidenceCollectionUseCase } from '../usecases/record-evidence-collection.usecase.js';
import { RecordEvidenceEntriesUseCase } from '../usecases/record-evidence-entries.usecase.js';
import { RenewSourceEvidencesUseCase } from '../usecases/renew-source-evidences.usecase.js';

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
 *  - `OpenEvidenceBatchUseCase`: abre a carga em lote de uma fonte (o dump
 *    diário do IBAMA), gravando o registro bruto e a evidência de cada
 *    registro em fluxo (UC14);
 *  - `RenewSourceEvidencesUseCase`: renova a validade das evidências de uma
 *    fonte em lote cujo dump não mudou (UC14);
 *  - `ListCompanyEvidencesUseCase`: as evidências de uma empresa com o estado
 *    de agora (`OUTDATED` derivado da validade).
 */
@Module({
  imports: [DataSourcesModule],
  providers: [
    /* Repositórios */
    { provide: EvidenceRepository, useClass: PrismaEvidenceRepository },
    { provide: RawEvidenceRepository, useClass: PrismaRawEvidenceRepository },

    /* Casos de uso */
    RecordEvidenceCollectionUseCase,
    RecordEvidenceEntriesUseCase,
    RenewSourceEvidencesUseCase,
    OpenEvidenceBatchUseCase,
    ListCompanyEvidencesUseCase,
  ],
  exports: [
    RecordEvidenceCollectionUseCase,
    RecordEvidenceEntriesUseCase,
    RenewSourceEvidencesUseCase,
    OpenEvidenceBatchUseCase,
    ListCompanyEvidencesUseCase,
  ],
})
export class EvidencesModule {}

import { Module } from '@nestjs/common';
import { CompanyRemovalRepository } from '../../domain/dtos/repositories/company-removal.repository.js';
import { CompanyRemovalsController } from '../../http/controllers/company-removals.controller.js';
import { PrismaCompanyRemovalRepository } from '../db/repositories/prisma-company-removal.repository.js';
import { ListCompanyRemovalsUseCase } from '../usecases/list-company-removals.usecase.js';
import { RemoveCompanyUseCase } from '../usecases/remove-company.usecase.js';
import { RestoreCompanyUseCase } from '../usecases/restore-company.usecase.js';

/**
 * Cadastros retirados a pedido do titular. Exporta o repositório para quem coleta dados de
 * empresas conferir a lista antes de gravar.
 *
 * Entidades (schemas Prisma em `../../entity`): `CompanyRemoval`.
 */
@Module({
  controllers: [CompanyRemovalsController],
  providers: [
    {
      provide: CompanyRemovalRepository,
      useClass: PrismaCompanyRemovalRepository,
    },
    ListCompanyRemovalsUseCase,
    RemoveCompanyUseCase,
    RestoreCompanyUseCase,
  ],
  exports: [CompanyRemovalRepository],
})
export class CompanyRemovalsModule {}

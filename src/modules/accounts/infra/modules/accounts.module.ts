import { Module } from '@nestjs/common';
import { UserTokenRepository } from '../../domain/dtos/repositories/user-token.repository.js';
import { PrismaUserTokenRepository } from '../db/repositories/prisma-user-token.repository.js';
import { ConsumeUserTokenUseCase } from '../usecases/consume-user-token.usecase.js';
import { IssueUserTokenUseCase } from '../usecases/issue-user-token.usecase.js';

/**
 * Contas de usuário: cadastro, confirmação de e-mail, edição, exclusão e
 * recuperação de senha (UC01, UC04, UC05).
 *
 * Entidades (schemas Prisma em `../../entity`): `User`, `UserToken`.
 *
 * Exporta a emissão e o consumo de tokens de uso único: os fluxos de cadastro,
 * recuperação de senha e troca de e-mail pedem um link ou o gastam, sem
 * conhecer o repositório nem o formato do token.
 */
@Module({
  providers: [
    /* Repositórios */
    { provide: UserTokenRepository, useClass: PrismaUserTokenRepository },

    /* Casos de uso */
    IssueUserTokenUseCase,
    ConsumeUserTokenUseCase,
  ],
  exports: [IssueUserTokenUseCase, ConsumeUserTokenUseCase],
})
export class AccountsModule {}

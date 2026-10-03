import { Module } from '@nestjs/common';

/**
 * Contas de usuário: cadastro, confirmação de e-mail, edição, exclusão e
 * recuperação de senha (UC01, UC04, UC05).
 *
 * Entidades (schemas Prisma em `../../entity`): `User`, `UserToken`.
 */
@Module({})
export class AccountsModule {}

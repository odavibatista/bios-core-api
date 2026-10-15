import { Module } from '@nestjs/common';
import { MailingModule } from '@modules/mailing/infra/modules/mailing.module.js';
import { SecurityModule } from '@modules/security/infra/modules/security.module.js';
import { UserTokenRepository } from '../../domain/dtos/repositories/user-token.repository.js';
import { UserRepository } from '../../domain/dtos/repositories/user.repository.js';
import { AccountsController } from '../../http/controllers/accounts.controller.js';
import { PrismaUserTokenRepository } from '../db/repositories/prisma-user-token.repository.js';
import { PrismaUserRepository } from '../db/repositories/prisma-user.repository.js';
import { ConfirmEmailChangeUseCase } from '../usecases/confirm-email-change.usecase.js';
import { ConfirmEmailUseCase } from '../usecases/confirm-email.usecase.js';
import { ConsumeUserTokenUseCase } from '../usecases/consume-user-token.usecase.js';
import { DeleteOwnAccountUseCase } from '../usecases/delete-own-account.usecase.js';
import { GetOwnAccountUseCase } from '../usecases/get-own-account.usecase.js';
import { IssueUserTokenUseCase } from '../usecases/issue-user-token.usecase.js';
import { RegisterUserUseCase } from '../usecases/register-user.usecase.js';
import { RequestEmailChangeUseCase } from '../usecases/request-email-change.usecase.js';
import { ResendEmailConfirmationUseCase } from '../usecases/resend-email-confirmation.usecase.js';
import { SendEmailConfirmationUseCase } from '../usecases/send-email-confirmation.usecase.js';
import { UpdateAccountUseCase } from '../usecases/update-account.usecase.js';
import { UpdateOwnAccountUseCase } from '../usecases/update-own-account.usecase.js';

/**
 * Contas de usuário: cadastro, confirmação de e-mail, edição, exclusão e
 * recuperação de senha (UC01, UC04, UC05).
 *
 * Entidades (schemas Prisma em `../../entity`): `User`, `UserToken`.
 *
 * Depende da blacklist de domínios (`SecurityModule`) para recusar cadastros e
 * do envio de e-mails transacionais (`MailingModule`) para os links.
 *
 * Exporta a emissão e o consumo de tokens de uso único — os fluxos de
 * recuperação de senha e troca de e-mail pedem um link ou o gastam, sem
 * conhecer o repositório nem o formato do token — e o contrato das contas
 * (`UserRepository`), de que a autenticação lê as credenciais.
 */
@Module({
  imports: [SecurityModule, MailingModule],
  controllers: [AccountsController],
  providers: [
    /* Repositórios */
    { provide: UserRepository, useClass: PrismaUserRepository },
    { provide: UserTokenRepository, useClass: PrismaUserTokenRepository },

    /* Casos de uso */
    IssueUserTokenUseCase,
    ConsumeUserTokenUseCase,
    SendEmailConfirmationUseCase,
    RegisterUserUseCase,
    ConfirmEmailUseCase,
    ResendEmailConfirmationUseCase,
    UpdateAccountUseCase,
    GetOwnAccountUseCase,
    UpdateOwnAccountUseCase,
    RequestEmailChangeUseCase,
    ConfirmEmailChangeUseCase,
    DeleteOwnAccountUseCase,
  ],
  exports: [
    UserRepository,
    IssueUserTokenUseCase,
    ConsumeUserTokenUseCase,
    UpdateAccountUseCase,
  ],
})
export class AccountsModule {}

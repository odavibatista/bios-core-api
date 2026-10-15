import { Module } from '@nestjs/common';
import { AccountsModule } from '@modules/accounts/infra/modules/accounts.module.js';
import { MailingModule } from '@modules/mailing/infra/modules/mailing.module.js';
import { SecurityModule } from '@modules/security/infra/modules/security.module.js';
import { LoginAttemptRepository } from '../../domain/dtos/repositories/login-attempt.repository.js';
import { UserSessionRepository } from '../../domain/dtos/repositories/user-session.repository.js';
import { AccessTokenProvider } from '../../domain/providers/access-token.provider.js';
import { AuthController } from '../../http/controllers/auth.controller.js';
import { PrismaLoginAttemptRepository } from '../db/repositories/prisma-login-attempt.repository.js';
import { PrismaUserSessionRepository } from '../db/repositories/prisma-user-session.repository.js';
import { JwtAccessTokenProvider } from '../providers/jwt-access-token.provider.js';
import { LoginUseCase } from '../usecases/login.usecase.js';

/**
 * Autenticação: login com bloqueio por tentativas, sessões JWT revogáveis
 * e encerramento de sessão (UC02, UC03, UC04 — alteração de senha).
 *
 * Entidades (schemas Prisma em `../../entity`): `UserSession`, `LoginAttempt`.
 *
 * Lê as credenciais pelo contrato das contas (`AccountsModule`), consulta e
 * aplica bloqueios pelo contrato de segurança (`SecurityModule`) e avisa o
 * titular por e-mail (`MailingModule`).
 */
@Module({
  imports: [AccountsModule, SecurityModule, MailingModule],
  controllers: [AuthController],
  providers: [
    /* Repositórios */
    { provide: LoginAttemptRepository, useClass: PrismaLoginAttemptRepository },
    { provide: UserSessionRepository, useClass: PrismaUserSessionRepository },

    /* Providers */
    { provide: AccessTokenProvider, useClass: JwtAccessTokenProvider },

    /* Casos de uso */
    LoginUseCase,
  ],
})
export class AuthenticationModule {}

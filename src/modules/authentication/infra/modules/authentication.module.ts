import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AccountsModule } from '@modules/accounts/infra/modules/accounts.module.js';
import { MailingModule } from '@modules/mailing/infra/modules/mailing.module.js';
import { SecurityModule } from '@modules/security/infra/modules/security.module.js';
import { LoginAttemptRepository } from '../../domain/dtos/repositories/login-attempt.repository.js';
import { UserSessionRepository } from '../../domain/dtos/repositories/user-session.repository.js';
import { AccessTokenProvider } from '../../domain/providers/access-token.provider.js';
import { AuthController } from '../../http/controllers/auth.controller.js';
import { AccessTokenGuard } from '../../http/guards/access-token.guard.js';
import { RoleGuard } from '../../http/guards/role.guard.js';
import { PrismaLoginAttemptRepository } from '../db/repositories/prisma-login-attempt.repository.js';
import { PrismaUserSessionRepository } from '../db/repositories/prisma-user-session.repository.js';
import { JwtAccessTokenProvider } from '../providers/jwt-access-token.provider.js';
import { ChangePasswordUseCase } from '../usecases/change-password.usecase.js';
import { LoginUseCase } from '../usecases/login.usecase.js';
import { LogoutUseCase } from '../usecases/logout.usecase.js';
import { RefreshSessionUseCase } from '../usecases/refresh-session.usecase.js';
import { ReplacePasswordUseCase } from '../usecases/replace-password.usecase.js';
import { RequestPasswordResetUseCase } from '../usecases/request-password-reset.usecase.js';
import { ResetPasswordUseCase } from '../usecases/reset-password.usecase.js';
import { SendSuspiciousLoginAlertUseCase } from '../usecases/send-suspicious-login-alert.usecase.js';

/**
 * Autenticação: login com bloqueio por tentativas, renovação de sessão com
 * rotação do refresh token, sessões JWT revogáveis e encerramento de sessão
 * (UC02, UC17, UC03, UC04 — alteração de senha).
 *
 * Registra o guard global de autenticação: toda rota exige uma sessão ativa,
 * exceto as marcadas com `@Public()`.
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
    SendSuspiciousLoginAlertUseCase,
    LoginUseCase,
    RefreshSessionUseCase,
    LogoutUseCase,
    ReplacePasswordUseCase,
    ChangePasswordUseCase,
    RequestPasswordResetUseCase,
    ResetPasswordUseCase,

    /* Autenticação exigida em toda rota que não seja `@Public()` */
    { provide: APP_GUARD, useClass: AccessTokenGuard },

    /* Papel exigido pelo `@Roles()` da rota; depois da autenticação, que dá o papel */
    { provide: APP_GUARD, useClass: RoleGuard },
  ],
})
export class AuthenticationModule {}

import { Module } from '@nestjs/common';

/**
 * Autenticação: login com bloqueio por tentativas, sessões JWT revogáveis
 * e encerramento de sessão (UC02, UC03, UC04 — alteração de senha).
 *
 * Entidades (schemas Prisma em `../../entity`): `UserSession`, `LoginAttempt`.
 */
@Module({})
export class AuthenticationModule {}

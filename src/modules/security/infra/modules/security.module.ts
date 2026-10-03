import { Module } from '@nestjs/common';

/**
 * Defesas de borda: bloqueios de IP/usuário, honeypot e blacklist de
 * domínios de e-mail (UC13, RF20, RF21).
 *
 * Entidades (schemas Prisma em `../../entity`): `AccessBlock`, `HoneypotHit`, `BlockedEmailDomain`.
 */
@Module({})
export class SecurityModule {}

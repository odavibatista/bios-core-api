import { Module } from '@nestjs/common';
import { BlockedEmailDomainRepository } from '../../domain/dtos/repositories/blocked-email-domain.repository.js';
import { EmailDomainPolicyProvider } from '../../domain/providers/email-domain-policy.provider.js';
import { PrismaBlockedEmailDomainRepository } from '../db/repositories/prisma-blocked-email-domain.repository.js';
import { CheckEmailDomainAllowedUseCase } from '../usecases/check-email-domain-allowed.usecase.js';

/**
 * Defesas de borda: bloqueios de IP/usuário, honeypot e blacklist de
 * domínios de e-mail (UC13, RF20, RF21).
 *
 * Entidades (schemas Prisma em `../../entity`): `AccessBlock`, `HoneypotHit`, `BlockedEmailDomain`.
 *
 * Exporta a política de domínios de e-mail pelo contrato de domínio
 * (`EmailDomainPolicyProvider`): cadastro e troca de e-mail consultam a
 * blacklist sem conhecer o repositório nem o caso de uso que a implementa.
 */
@Module({
  providers: [
    /* Repositórios */
    {
      provide: BlockedEmailDomainRepository,
      useClass: PrismaBlockedEmailDomainRepository,
    },

    /* Casos de uso */
    CheckEmailDomainAllowedUseCase,
    {
      provide: EmailDomainPolicyProvider,
      useExisting: CheckEmailDomainAllowedUseCase,
    },
  ],
  exports: [EmailDomainPolicyProvider],
})
export class SecurityModule {}

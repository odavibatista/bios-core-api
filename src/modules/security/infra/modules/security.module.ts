import { Module } from '@nestjs/common';
import { AccessBlockRepository } from '../../domain/dtos/repositories/access-block.repository.js';
import { BlockedEmailDomainRepository } from '../../domain/dtos/repositories/blocked-email-domain.repository.js';
import { EmailDomainPolicyProvider } from '../../domain/providers/email-domain-policy.provider.js';
import { PrismaAccessBlockRepository } from '../db/repositories/prisma-access-block.repository.js';
import { PrismaBlockedEmailDomainRepository } from '../db/repositories/prisma-blocked-email-domain.repository.js';
import { CheckEmailDomainAllowedUseCase } from '../usecases/check-email-domain-allowed.usecase.js';

/**
 * Defesas de borda: bloqueios de IP/usuário, honeypot e blacklist de
 * domínios de e-mail (UC13, RF20, RF21).
 *
 * Entidades (schemas Prisma em `../../entity`): `AccessBlock`, `HoneypotHit`, `BlockedEmailDomain`.
 *
 * Exporta pelos contratos de domínio: a política de domínios de e-mail
 * (`EmailDomainPolicyProvider`), consultada por cadastro e troca de e-mail, e
 * os bloqueios de acesso (`AccessBlockRepository`), consultados e aplicados
 * pelo login. Quem usa não conhece a infraestrutura que os implementa.
 */
@Module({
  providers: [
    /* Repositórios */
    {
      provide: BlockedEmailDomainRepository,
      useClass: PrismaBlockedEmailDomainRepository,
    },
    { provide: AccessBlockRepository, useClass: PrismaAccessBlockRepository },

    /* Casos de uso */
    CheckEmailDomainAllowedUseCase,
    {
      provide: EmailDomainPolicyProvider,
      useExisting: CheckEmailDomainAllowedUseCase,
    },
  ],
  exports: [EmailDomainPolicyProvider, AccessBlockRepository],
})
export class SecurityModule {}

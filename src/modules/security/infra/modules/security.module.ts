import { Module } from '@nestjs/common';
import { AccessBlockRepository } from '../../domain/dtos/repositories/access-block.repository.js';
import { BlockedEmailDomainRepository } from '../../domain/dtos/repositories/blocked-email-domain.repository.js';
import { EmailDomainPolicyProvider } from '../../domain/providers/email-domain-policy.provider.js';
import { PrismaAccessBlockRepository } from '../db/repositories/prisma-access-block.repository.js';
import { PrismaBlockedEmailDomainRepository } from '../db/repositories/prisma-blocked-email-domain.repository.js';
import { BlockedEmailDomainsController } from '../../http/controllers/blocked-email-domains.controller.js';
import { AddBlockedEmailDomainUseCase } from '../usecases/add-blocked-email-domain.usecase.js';
import { CheckEmailDomainAllowedUseCase } from '../usecases/check-email-domain-allowed.usecase.js';
import { ListBlockedEmailDomainsUseCase } from '../usecases/list-blocked-email-domains.usecase.js';
import { RemoveBlockedEmailDomainUseCase } from '../usecases/remove-blocked-email-domain.usecase.js';

/**
 * Defesas de borda: bloqueios de IP/usuário, honeypot e blacklist de
 * domínios de e-mail (UC13, RF20, RF21), com a manutenção da blacklist pelo
 * administrador (`/admin/blocked-email-domains`, RF29).
 *
 * Entidades (schemas Prisma em `../../entity`): `AccessBlock`, `HoneypotHit`, `BlockedEmailDomain`.
 *
 * Exporta pelos contratos de domínio: a política de domínios de e-mail
 * (`EmailDomainPolicyProvider`), consultada por cadastro e troca de e-mail, e
 * os bloqueios de acesso (`AccessBlockRepository`), consultados e aplicados
 * pelo login. Quem usa não conhece a infraestrutura que os implementa.
 */
@Module({
  controllers: [BlockedEmailDomainsController],
  providers: [
    /* Repositórios */
    {
      provide: BlockedEmailDomainRepository,
      useClass: PrismaBlockedEmailDomainRepository,
    },
    { provide: AccessBlockRepository, useClass: PrismaAccessBlockRepository },

    /* Casos de uso */
    CheckEmailDomainAllowedUseCase,
    ListBlockedEmailDomainsUseCase,
    AddBlockedEmailDomainUseCase,
    RemoveBlockedEmailDomainUseCase,
    {
      provide: EmailDomainPolicyProvider,
      useExisting: CheckEmailDomainAllowedUseCase,
    },
  ],
  exports: [EmailDomainPolicyProvider, AccessBlockRepository],
})
export class SecurityModule {}

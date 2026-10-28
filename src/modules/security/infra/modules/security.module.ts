import {
  type MiddlewareConsumer,
  Module,
  type NestModule,
  RequestMethod,
} from '@nestjs/common';
import { RedisModule } from '@shared/infra/modules/redis.module.js';
import { AccessBlockRepository } from '../../domain/dtos/repositories/access-block.repository.js';
import { BlockedEmailDomainRepository } from '../../domain/dtos/repositories/blocked-email-domain.repository.js';
import { HoneypotHitRepository } from '../../domain/dtos/repositories/honeypot-hit.repository.js';
import { BlockedIpRegistry } from '../../domain/providers/blocked-ip-registry.provider.js';
import { EmailDomainPolicyProvider } from '../../domain/providers/email-domain-policy.provider.js';
import { BlockedEmailDomainsController } from '../../http/controllers/blocked-email-domains.controller.js';
import { HoneypotInterceptor } from '../../http/interceptors/honeypot.interceptor.js';
import { BlockedIpMiddleware } from '../../http/middlewares/blocked-ip.middleware.js';
import { PrismaAccessBlockRepository } from '../db/repositories/prisma-access-block.repository.js';
import { PrismaBlockedEmailDomainRepository } from '../db/repositories/prisma-blocked-email-domain.repository.js';
import { PrismaHoneypotHitRepository } from '../db/repositories/prisma-honeypot-hit.repository.js';
import { HoneypotExemptions } from '../providers/honeypot-exemptions.js';
import { RedisBlockedIpRegistry } from '../providers/redis-blocked-ip-registry.provider.js';
import { AddBlockedEmailDomainUseCase } from '../usecases/add-blocked-email-domain.usecase.js';
import { CheckEmailDomainAllowedUseCase } from '../usecases/check-email-domain-allowed.usecase.js';
import { ListBlockedEmailDomainsUseCase } from '../usecases/list-blocked-email-domains.usecase.js';
import { RegisterHoneypotHitUseCase } from '../usecases/register-honeypot-hit.usecase.js';
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
 * pelo login. Exporta também o que o `@Honeypot()` usa nas rotas isca (módulo
 * `honeypot`, #88). Quem usa não conhece a infraestrutura que os implementa.
 *
 * Aplica a toda rota a recusa dos IPs bloqueados pelo honeypot (`BlockedIpMiddleware`),
 * com a lista de IPs no Redis (`RedisModule`, importado aqui como nos demais módulos que
 * dependem dele).
 */
@Module({
  imports: [RedisModule],
  controllers: [BlockedEmailDomainsController],
  providers: [
    /* Repositórios */
    {
      provide: BlockedEmailDomainRepository,
      useClass: PrismaBlockedEmailDomainRepository,
    },
    { provide: AccessBlockRepository, useClass: PrismaAccessBlockRepository },
    { provide: HoneypotHitRepository, useClass: PrismaHoneypotHitRepository },

    /* Providers */
    { provide: BlockedIpRegistry, useClass: RedisBlockedIpRegistry },
    HoneypotExemptions,

    /* Casos de uso */
    CheckEmailDomainAllowedUseCase,
    ListBlockedEmailDomainsUseCase,
    AddBlockedEmailDomainUseCase,
    RemoveBlockedEmailDomainUseCase,
    RegisterHoneypotHitUseCase,
    {
      provide: EmailDomainPolicyProvider,
      useExisting: CheckEmailDomainAllowedUseCase,
    },

    /* Honeypot (RF21) */
    HoneypotInterceptor,
  ],
  exports: [
    EmailDomainPolicyProvider,
    AccessBlockRepository,
    HoneypotInterceptor,
    RegisterHoneypotHitUseCase,
  ],
})
export class SecurityModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(BlockedIpMiddleware)
      .forRoutes({ path: '{*path}', method: RequestMethod.ALL });
  }
}

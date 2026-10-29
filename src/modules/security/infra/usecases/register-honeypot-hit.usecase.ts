import { Injectable } from '@nestjs/common';
import { AccessBlockReason, AccessBlockScope } from '@prisma/client';
import { normalizeIp } from '@shared/config/network.config.js';
import { UseCase } from '@shared/domain/protocols/use-case.protocol.js';
import { AccessBlockRepository } from '../../domain/dtos/repositories/access-block.repository.js';
import {
  HoneypotHitRepository,
  type NewHoneypotHit,
} from '../../domain/dtos/repositories/honeypot-hit.repository.js';
import { BlockedIpRegistry } from '../../domain/providers/blocked-ip-registry.provider.js';
import { HoneypotExemptions } from '../providers/honeypot-exemptions.js';

/**
 * - `BLOCKED`: o IP passou a ser recusado em toda rota;
 * - `ALREADY_BLOCKED`: já estava (ex.: duas chamadas simultâneas à isca);
 * - `EXEMPT`: IP isento (`HONEYPOT_EXEMPT_IPS`), só registrado.
 */
export type HoneypotHitOutcome = 'BLOCKED' | 'ALREADY_BLOCKED' | 'EXEMPT';

/**
 * Registra a chamada a um endpoint isca e bloqueia o IP sem prazo (RF21, HU34).
 *
 * O bloqueio é gravado no banco (`access_blocks`, `reason=HONEYPOT`, sem `blocked_until`),
 * que é a fonte de verdade e a trilha de auditoria, e espelhado no registro consultado a
 * cada requisição. Quem chama é o `@Honeypot()`: as rotas reais não passam por aqui.
 */
@Injectable()
export class RegisterHoneypotHitUseCase extends UseCase<
  NewHoneypotHit,
  HoneypotHitOutcome
> {
  constructor(
    private readonly hits: HoneypotHitRepository,
    private readonly blocks: AccessBlockRepository,
    private readonly registry: BlockedIpRegistry,
    private readonly exemptions: HoneypotExemptions,
  ) {
    super();
  }

  override async execute(hit: NewHoneypotHit): Promise<HoneypotHitOutcome> {
    const ip = normalizeIp(hit.ip);

    await this.hits.record({ ...hit, ip });

    if (this.exemptions.has(ip)) return 'EXEMPT';
    if (await this.registry.isBlocked(ip)) return 'ALREADY_BLOCKED';

    await this.blocks.create({
      target: { scope: AccessBlockScope.IP, ip },
      reason: AccessBlockReason.HONEYPOT,
      blockedUntil: null,
    });
    await this.registry.add(ip);

    return 'BLOCKED';
  }
}

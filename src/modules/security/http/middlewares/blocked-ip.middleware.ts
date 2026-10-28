import { Injectable, Logger, type NestMiddleware } from '@nestjs/common';
import { normalizeIp } from '@shared/config/network.config.js';
import { IpBlockedException } from '../../domain/dtos/errors/ip-blocked.exception.js';
import { BlockedIpRegistry } from '../../domain/providers/blocked-ip-registry.provider.js';
import { HoneypotExemptions } from '../../infra/providers/honeypot-exemptions.js';

/**
 * Recusa, em qualquer rota (real ou isca, pública ou não), o IP bloqueado sem prazo pelo
 * honeypot (RF21): `403 ACCESS_BLOCKED`, antes do limite de requisições e da autenticação.
 *
 * Fecha só quando sabe: se nem o Redis nem o banco responderem, a requisição segue, porque
 * o honeypot não pode derrubar as rotas reais (NFSE07). IP isento nunca é recusado.
 */
@Injectable()
export class BlockedIpMiddleware implements NestMiddleware {
  private readonly logger = new Logger(BlockedIpMiddleware.name);

  constructor(
    private readonly registry: BlockedIpRegistry,
    private readonly exemptions: HoneypotExemptions,
  ) {}

  async use(
    request: { ip?: string },
    _response: unknown,
    next: (error?: unknown) => void,
  ): Promise<void> {
    if (!request.ip) return next();

    const ip = normalizeIp(request.ip);

    if (this.exemptions.has(ip)) return next();

    let blocked: boolean;

    try {
      blocked = await this.registry.isBlocked(ip);
    } catch (error) {
      this.logger.error(
        `Bloqueio de IP não conferido (${error instanceof Error ? error.name : typeof error}): requisição liberada.`,
      );
      return next();
    }

    // Lançada, e não passada ao `next`: assim passa pelo filtro de erros do Nest e sai no
    // corpo de erro padronizado.
    if (blocked) throw new IpBlockedException();

    next();
  }
}

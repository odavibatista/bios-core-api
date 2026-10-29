import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '@shared/config/environment.config.js';
import { addressSet } from '@shared/config/network.config.js';

/**
 * IPs que o honeypot nunca bloqueia (`HONEYPOT_EXEMPT_IPS`; padrão: loopback e redes
 * internas, onde vivem o proxy reverso e o monitoramento). A chamada deles a uma isca é
 * registrada mesmo assim; e um bloqueio antigo deixa de valer se o IP passar a ser isento.
 */
@Injectable()
export class HoneypotExemptions {
  private readonly exempt: { has(ip: string): boolean };

  constructor(config: ConfigService<Environment, true>) {
    this.exempt = addressSet(
      config.get('HONEYPOT_EXEMPT_IPS', { infer: true }),
    );
  }

  has(ip: string): boolean {
    return this.exempt.has(ip);
  }
}

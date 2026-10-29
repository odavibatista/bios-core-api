import { Injectable, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpAdapterHost } from '@nestjs/core';
import type { Environment } from '../../config/environment.config.js';

/**
 * Aplica `TRUST_PROXY` ao `trust proxy` do Express (#87).
 *
 * Com o proxy reverso declarado, `request.ip` é o IP do cliente que o proxy informa em
 * `X-Forwarded-For`, e não o do proxy: é o IP que o limite de requisições conta e que o
 * honeypot bloqueia. Fica num provider, e não no `main.ts`, para valer igual em qualquer
 * aplicação montada a partir do `AppModule` (inclusive a dos testes e2e).
 */
@Injectable()
export class TrustProxySetup implements OnModuleInit {
  constructor(
    private readonly adapterHost: HttpAdapterHost,
    private readonly config: ConfigService<Environment, true>,
  ) {}

  onModuleInit(): void {
    const express = this.adapterHost.httpAdapter as
      | { getInstance(): { set(setting: string, value: unknown): void } }
      | undefined;

    // Sem servidor HTTP (ex.: um contexto de aplicação para comandos), nada a configurar.
    express
      ?.getInstance()
      .set('trust proxy', this.config.get('TRUST_PROXY', { infer: true }));
  }
}

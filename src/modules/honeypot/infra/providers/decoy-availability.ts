import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '@shared/config/environment.config.js';
import { DecoyUnavailableException } from '../../domain/dtos/errors/decoy-unavailable.exception.js';

/** Fonte de aleatoriedade das iscas (número em [0, 1)); trocável nos testes. */
export const DECOY_RANDOM = Symbol('DECOY_RANDOM');

export type DecoyRandom = () => number;

/**
 * Baixa disponibilidade proposital das iscas (RF21): uma fração das chamadas
 * (`HONEYPOT_FAILURE_RATE`) responde `503`, e as demais demoram até
 * `HONEYPOT_MAX_DELAY_MS`. Atrasa e frustra a raspagem, e vale só para as iscas: as rotas
 * reais nunca passam por aqui (NFSE07).
 */
@Injectable()
export class DecoyAvailability {
  private readonly failureRate: number;
  private readonly maxDelayMs: number;

  constructor(
    config: ConfigService<Environment, true>,
    @Inject(DECOY_RANDOM) private readonly random: DecoyRandom,
  ) {
    this.failureRate = config.get('HONEYPOT_FAILURE_RATE', { infer: true });
    this.maxDelayMs = config.get('HONEYPOT_MAX_DELAY_MS', { infer: true });
  }

  /**
   * Falha ou demora, conforme a sorte da chamada.
   *
   * @throws {DecoyUnavailableException} na fração configurada das chamadas.
   */
  async simulate(): Promise<void> {
    if (this.random() < this.failureRate) throw new DecoyUnavailableException();

    const delay = Math.floor(this.random() * this.maxDelayMs);

    if (delay > 0) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

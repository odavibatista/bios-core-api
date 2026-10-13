import type { ConfigService } from '@nestjs/config';
import type { ThrottlerOptions } from '@nestjs/throttler';
import type { Environment } from './environment.config.js';

/**
 * Cabeçalho que identifica o integrador na API pública (RF17).
 *
 * É a chave de rastreio do limite da API pública: cada integrador tem a própria
 * cota, em vez de dividir a do endereço IP com os demais.
 */
export const API_KEY_HEADER = 'x-api-key';

/** Prefixo das chaves de contagem no Redis. */
export const THROTTLER_KEY_PREFIX = 'bios:throttle';

/**
 * Limites declarados.
 *
 *  - `default`: todo endpoint, contado por IP;
 *  - `publicApi`: endpoints da API pública, contados por chave de API.
 */
export const ThrottlerName = {
  DEFAULT: 'default',
  PUBLIC_API: 'publicApi',
} as const;

export type ThrottlerName = (typeof ThrottlerName)[keyof typeof ThrottlerName];

/** Chave de API informada na requisição, quando houver. */
export function apiKeyOf(request: {
  headers?: Record<string, unknown>;
}): string | undefined {
  const header = request.headers?.[API_KEY_HEADER];

  return typeof header === 'string' && header.trim() !== ''
    ? header.trim()
    : undefined;
}

/**
 * Limites a partir da configuração validada.
 *
 * O limite da API pública tem chave de rastreio própria: a chave de API, com o
 * IP como alternativa para quem ainda não se identificou — sem isso, uma única
 * requisição sem chave zeraria a cota de todos os integradores atrás do mesmo
 * endereço.
 */
export function buildThrottlers(
  configService: ConfigService<Environment, true>,
): ThrottlerOptions[] {
  return [
    {
      name: ThrottlerName.DEFAULT,
      ttl:
        configService.get('THROTTLE_TTL', { infer: true }).toSeconds() * 1_000,
      limit: configService.get('THROTTLE_LIMIT', { infer: true }),
    },
    {
      name: ThrottlerName.PUBLIC_API,
      ttl:
        configService
          .get('THROTTLE_PUBLIC_API_TTL', { infer: true })
          .toSeconds() * 1_000,
      limit: configService.get('THROTTLE_PUBLIC_API_LIMIT', { infer: true }),
      getTracker: (request: {
        headers?: Record<string, unknown>;
        ip?: string;
      }) => apiKeyOf(request) ?? request.ip ?? 'desconhecido',
    },
  ];
}

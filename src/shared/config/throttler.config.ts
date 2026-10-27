import { createHash } from 'node:crypto';
import type { ExecutionContext } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { ThrottlerOptions } from '@nestjs/throttler';
import { IS_PUBLIC_API_ROUTE } from '../http/decorators/public-api-route.decorator.js';
import { ROUTE_RATE_LIMIT } from '../http/decorators/route-rate-limit.decorator.js';
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
 *  - `publicApi`: só os endpoints marcados com `@PublicApiRoute()`, contados
 *    por chave de API (e somados ao `default`);
 *  - os limites próprios das rotas de empresa (`ROUTE_THROTTLERS`): cada um só nas rotas
 *    marcadas com `@RouteRateLimit()`, contados por IP, no lugar do `default`.
 */
export const ThrottlerName = {
  DEFAULT: 'default',
  PUBLIC_API: 'publicApi',
  COMPANY_PROFILE: 'companyProfile',
  COMPANY_EVIDENCES: 'companyEvidences',
  COMPANY_SEARCH: 'companySearch',
  COMPANY_EXPORT: 'companyExport',
} as const;

export type ThrottlerName = (typeof ThrottlerName)[keyof typeof ThrottlerName];

/** Limites próprios de rota e a variável de ambiente que dá o valor de cada um. */
export const ROUTE_THROTTLERS = {
  [ThrottlerName.COMPANY_PROFILE]: 'THROTTLE_COMPANY_PROFILE_LIMIT',
  [ThrottlerName.COMPANY_EVIDENCES]: 'THROTTLE_COMPANY_EVIDENCES_LIMIT',
  [ThrottlerName.COMPANY_SEARCH]: 'THROTTLE_COMPANY_SEARCH_LIMIT',
  [ThrottlerName.COMPANY_EXPORT]: 'THROTTLE_COMPANY_EXPORT_LIMIT',
} as const satisfies Partial<Record<ThrottlerName, keyof Environment>>;

export type RouteThrottlerName = keyof typeof ROUTE_THROTTLERS;

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
 * Chave de rastreio do limite da API pública: o resumo da chave de API, com o
 * IP como alternativa para quem ainda não se identificou — sem isso, uma única
 * requisição sem chave zeraria a cota de todos os integradores atrás do mesmo
 * endereço.
 *
 * É o resumo, e não a chave, que vira nome de chave no Redis: o contador não
 * pode guardar o segredo do integrador em claro. O resumo cobre também a chave
 * inválida (cada valor inventado ganha o próprio contador, que expira com a
 * janela), e o limite geral por IP, que segue valendo, impede que isso vire
 * um meio de encher o Redis.
 */
function publicApiTrackerOf(request: {
  headers?: Record<string, unknown>;
  ip?: string;
}): string {
  const apiKey = apiKeyOf(request);

  return apiKey
    ? `key:${createHash('sha256').update(apiKey).digest('hex').slice(0, 32)}`
    : (request.ip ?? 'desconhecido');
}

/** O endpoint é da API pública? Só nele o limite `publicApi` incide. */
function isPublicApiRoute(context: ExecutionContext): boolean {
  return (
    new Reflector().getAllAndOverride<boolean | undefined>(
      IS_PUBLIC_API_ROUTE,
      [context.getHandler(), context.getClass()],
    ) === true
  );
}

/** Limite próprio declarado na rota, quando houver (`@RouteRateLimit()`). */
function routeRateLimitOf(context: ExecutionContext): string | undefined {
  return new Reflector().getAllAndOverride<string | undefined>(
    ROUTE_RATE_LIMIT,
    [context.getHandler(), context.getClass()],
  );
}

/**
 * Limites a partir da configuração validada.
 *
 * O limite da API pública tem chave de rastreio própria (`publicApiTrackerOf`)
 * e é dispensado nos endpoints que não são da API pública, para que o teto de
 * um integrador não seja gasto, por soma, nas rotas internas do sistema.
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
      getTracker: publicApiTrackerOf,
      skipIf: (context) => !isPublicApiRoute(context),
    },
    ...(
      Object.entries(ROUTE_THROTTLERS) as [
        RouteThrottlerName,
        (typeof ROUTE_THROTTLERS)[RouteThrottlerName],
      ][]
    ).map(([name, variable]): ThrottlerOptions => ({
      name,
      ttl:
        configService.get('THROTTLE_TTL', { infer: true }).toSeconds() * 1_000,
      limit: configService.get(variable, { infer: true }),
      skipIf: (context) => routeRateLimitOf(context) !== name,
    })),
  ];
}

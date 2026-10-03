import { z } from 'zod';
import { EnvironmentException } from '../domain/errors/environment.exception.js';
import {
  Duration,
  type DurationText,
} from '../domain/value-objects/duration.js';

/**
 * Ambientes de execução suportados.
 */
export const RuntimeEnvironment = {
  DEVELOPMENT: 'development',
  TEST: 'test',
  PRODUCTION: 'production',
} as const;

interface DurationBounds {
  minimum: DurationText;
  maximum?: DurationText;
}

/**
 * Variável de duração: texto com unidade (ex.: `15m`, `12h`, `7d`, `4w`)
 * convertido em `Duration` e restrito ao intervalo informado.
 */
function durationVariable(
  defaultValue: DurationText,
  { minimum, maximum }: DurationBounds,
) {
  const lowerBound = Duration.parse(minimum);
  const upperBound = maximum ? Duration.parse(maximum) : undefined;
  const range = upperBound
    ? `entre ${lowerBound.toString()} e ${upperBound.toString()}`
    : `de no mínimo ${lowerBound.toString()}`;

  return z
    .string()
    .default(defaultValue)
    .transform((text, context) => {
      const duration = Duration.tryParse(text);

      if (
        !duration?.isAtLeast(lowerBound) ||
        (upperBound && !upperBound.isAtLeast(duration))
      ) {
        context.addIssue({
          code: 'custom',
          message: `deve ser uma duração ${range} (ex.: 15m, 12h, 7d, 4w)`,
        });
        return z.NEVER;
      }

      return duration;
    });
}

/**
 * Retenção de dados. O processo de expiração do MongoDB roda a cada 60
 * segundos; prazos menores que 1 minuto não teriam efeito prático.
 */
function retentionDuration(defaultValue: DurationText) {
  return durationVariable(defaultValue, { minimum: '1m' });
}

/**
 * Schema das variáveis de ambiente da aplicação.
 *
 * Validado uma única vez no bootstrap (via `ConfigModule.forRoot({ validate })`):
 * configuração ausente ou inválida impede a aplicação de subir.
 */
export const environmentSchema = z.object({
  NODE_ENV: z
    .enum(Object.values(RuntimeEnvironment))
    .default(RuntimeEnvironment.DEVELOPMENT),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z
    .string()
    .regex(/^mongodb(\+srv)?:\/\//, 'deve ser uma connection string MongoDB'),
  CORS_ORIGINS: z
    .string()
    .default('*')
    .transform((origins): true | string[] =>
      origins.trim() === '*'
        ? true
        : origins
            .split(',')
            .map((origin) => origin.trim())
            .filter(Boolean),
    ),

  /* Sessões (RF32, NFSE05) — access token curto; refresh token renovado a cada rotação */
  AUTH_ACCESS_TOKEN_LIFETIME: durationVariable('15m', {
    minimum: '1m',
    maximum: '60m',
  }),
  AUTH_REFRESH_TOKEN_LIFETIME: durationVariable('7d', { minimum: '1h' }),

  /* Retenção de dados (índices TTL) — ver data-retention.config.ts */
  DATA_RETENTION_SYNC_ON_BOOT: z.stringbool().default(true),
  DATA_RETENTION_USER_TOKENS: retentionDuration('7d'),
  DATA_RETENTION_USER_SESSIONS: retentionDuration('30d'),
  DATA_RETENTION_ACCESS_BLOCKS: retentionDuration('90d'),
  DATA_RETENTION_LOGIN_ATTEMPTS: retentionDuration('90d'),
  DATA_RETENTION_HONEYPOT_HITS: retentionDuration('180d'),
  DATA_RETENTION_EMAIL_DISPATCH_LOGS: retentionDuration('180d'),
  DATA_RETENTION_DATA_SOURCE_REQUEST_LOGS: retentionDuration('90d'),
});

/**
 * Configuração da aplicação já validada e tipada.
 *
 * Consumida via `ConfigService<Environment, true>`.
 */
export type Environment = z.infer<typeof environmentSchema>;

/**
 * Valida as variáveis de ambiente brutas.
 *
 * @throws {EnvironmentException} quando alguma variável está ausente ou inválida.
 */
export function validateEnvironment(
  rawEnvironment: Record<string, unknown>,
): Environment {
  const result = environmentSchema.safeParse(rawEnvironment);

  if (!result.success) throw new EnvironmentException(result.error.issues);

  return result.data;
}

import { z } from 'zod';
import { EnvironmentException } from '../domain/errors/environment.exception.js';
import {
  Duration,
  type DurationText,
} from '../domain/value-objects/duration.js';
import { encryptionKeyring, singleKey } from './encryption.config.js';

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
  // Somente o valor do token, enviado em chave-api-dados; nunca o JSON de headers.
  CGU_API_KEY: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z
      .string()
      .regex(
        /^[\x21-\x7e]{1,4096}$/,
        'deve ser um token HTTP sem espaços ou controles',
      )
      .refine(
        (key) => !key.startsWith('troque-'),
        'substitua o exemplo pelo token da CGU',
      )
      .optional(),
  ),
  DATABASE_URL: z
    .string()
    .regex(/^mongodb(\+srv)?:\/\//, 'deve ser uma connection string MongoDB'),
  REDIS_URL: z
    .string()
    .regex(/^rediss?:\/\//, 'deve ser uma URL Redis (redis:// ou rediss://)'),
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

  /* E-mails transacionais (RF18). Sem SMTP configurado a aplicação não sobe:
     confirmação de cadastro e recuperação de senha dependem de envio. */
  SMTP_HOST: z.string().nonempty(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535),
  SMTP_USER: z.string().nonempty(),
  SMTP_PASSWORD: z.string().nonempty(),
  MAIL_FROM: z.string().nonempty(),

  /* Base dos links enviados por e-mail (confirmação de cadastro, redefinição
     de senha). É o endereço do front-end, não o da API. */
  FRONTEND_URL: z
    .string()
    .regex(/^https?:\/\//, 'deve ser uma URL http:// ou https://'),

  /* Criptografia de dados sensíveis (NFSE03) — ver encryption.config.ts */
  ENCRYPTION_KEYS: encryptionKeyring(),
  BLIND_INDEX_KEY: singleKey(),

  /* Custo do bcrypt: cada incremento dobra o tempo de verificação da senha.
     O mínimo e o máximo são os limites do próprio algoritmo. */
  BCRYPT_COST: z.coerce.number().int().min(4).max(31).default(12),

  /* Filas (NFCO01) — ver queue.config.ts.
     O prazo da espera por um job limita o tempo que o usuário aguarda uma fonte
     externa; estourado, o chamador decide entre falhar ou seguir sem o dado. */
  QUEUE_WAIT_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(1_000)
    .max(60_000)
    .default(10_000),
  QUEUE_SCHEDULES_SYNC_ON_BOOT: z.stringbool().default(true),

  /* Cache de consultas (NFDE01) — ver cache.config.ts.
     Vale apenas como reserva: a janela de cada consulta vem de
     `data_sources.cache_ttl_seconds`, ajustável no banco sem novo deploy. */
  CACHE_DEFAULT_TTL: durationVariable('7d', { minimum: '1m' }),

  /* Limite de requisições (NFSE04) — ver throttler.config.ts.
     O limite geral é contado por IP; o da API pública, por chave de API. */
  THROTTLE_TTL: durationVariable('1m', { minimum: '1s', maximum: '1h' }),
  THROTTLE_LIMIT: z.coerce.number().int().min(1).default(120),
  THROTTLE_PUBLIC_API_TTL: durationVariable('1m', {
    minimum: '1s',
    maximum: '1h',
  }),
  THROTTLE_PUBLIC_API_LIMIT: z.coerce.number().int().min(1).default(60),

  /* Sessões (RF32, NFSE05) — access token curto; refresh token renovado a cada rotação.
     O access token é assinado com HMAC-SHA256 (HS256) por este segredo de 32 bytes:
     trocá-lo invalida os access tokens em circulação (vivem 15 minutos), mas não as
     sessões, que seguem renováveis pelo refresh token. */
  AUTH_ACCESS_TOKEN_SECRET: singleKey(),
  AUTH_ACCESS_TOKEN_LIFETIME: durationVariable('15m', {
    minimum: '1m',
    maximum: '60m',
  }),
  AUTH_REFRESH_TOKEN_LIFETIME: durationVariable('7d', { minimum: '1h' }),

  /* Links enviados por e-mail (RF25, RF28) — de uso único e validade limitada.
     A confirmação (de cadastro ou de novo e-mail) vive mais: o usuário pode abrir
     a caixa de entrada no dia seguinte. A redefinição de senha é curta de
     propósito, pois quem tem o link troca a senha da conta. */
  AUTH_EMAIL_CONFIRMATION_TOKEN_LIFETIME: durationVariable('24h', {
    minimum: '1h',
    maximum: '7d',
  }),
  AUTH_PASSWORD_RESET_TOKEN_LIFETIME: durationVariable('2h', {
    minimum: '5m',
    maximum: '24h',
  }),

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

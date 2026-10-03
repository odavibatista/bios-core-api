import type { ConfigService } from '@nestjs/config';
import type { RetentionPolicy } from '../domain/dtos/providers/retention-policy.dto.js';
import type { Environment } from './environment.config.js';

/** Variáveis de ambiente que definem um prazo de retenção. */
type RetentionSetting = Exclude<
  Extract<keyof Environment, `DATA_RETENTION_${string}`>,
  'DATA_RETENTION_SYNC_ON_BOOT'
>;

interface RetentionRule extends Omit<RetentionPolicy, 'retention'> {
  setting: RetentionSetting;
}

/**
 * Coleções com retenção limitada.
 *
 * Para registros com data de expiração (tokens, sessões, bloqueios), a retenção
 * conta a partir do vencimento; para logs, a partir do registro do evento.
 * Cada `indexName` corresponde a um índice simples declarado no schema Prisma
 * do módulo dono da coleção, convertido em índice TTL na inicialização.
 */
export const RETENTION_RULES: readonly RetentionRule[] = [
  {
    collection: 'user_tokens',
    field: 'expires_at',
    indexName: 'idx_user_tokens_expires_at',
    setting: 'DATA_RETENTION_USER_TOKENS',
  },
  {
    collection: 'user_sessions',
    field: 'expires_at',
    indexName: 'idx_user_sessions_expires_at',
    setting: 'DATA_RETENTION_USER_SESSIONS',
  },
  {
    collection: 'access_blocks',
    field: 'blocked_until',
    indexName: 'idx_access_blocks_blocked_until',
    setting: 'DATA_RETENTION_ACCESS_BLOCKS',
  },
  {
    collection: 'login_attempts',
    field: 'attempted_at',
    indexName: 'idx_login_attempts_attempted_at',
    setting: 'DATA_RETENTION_LOGIN_ATTEMPTS',
  },
  {
    collection: 'honeypot_hits',
    field: 'hit_at',
    indexName: 'idx_honeypot_hits_hit_at',
    setting: 'DATA_RETENTION_HONEYPOT_HITS',
  },
  {
    collection: 'email_dispatch_logs',
    field: 'created_at',
    indexName: 'idx_email_dispatch_logs_created_at',
    setting: 'DATA_RETENTION_EMAIL_DISPATCH_LOGS',
  },
  {
    collection: 'data_source_request_logs',
    field: 'requested_at',
    indexName: 'idx_data_source_request_logs_requested_at',
    setting: 'DATA_RETENTION_DATA_SOURCE_REQUEST_LOGS',
  },
];

/**
 * Monta as políticas de retenção a partir da configuração validada.
 */
export function buildRetentionPolicies(
  configService: ConfigService<Environment, true>,
): RetentionPolicy[] {
  return RETENTION_RULES.map(({ setting, ...rule }) => ({
    ...rule,
    retention: configService.get(setting, { infer: true }),
  }));
}

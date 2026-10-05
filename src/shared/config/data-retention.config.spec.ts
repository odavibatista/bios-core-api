import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ConfigService } from '@nestjs/config';
import { buildDuration } from '@test/factories/shared/duration.factory.js';
import {
  buildRetentionPolicies,
  RETENTION_RULES,
} from './data-retention.config.js';
import type { Environment } from './environment.config.js';

const MODULES_DIRECTORY = join(import.meta.dirname, '..', '..', 'modules');

/** Conteúdo de todos os schemas Prisma de entidades. */
function readEntitySchemas(): string {
  return (readdirSync(MODULES_DIRECTORY, { recursive: true }) as string[])
    .filter((file) => file.endsWith('.prisma'))
    .map((file) => readFileSync(join(MODULES_DIRECTORY, file), 'utf8'))
    .join('\n');
}

describe('data-retention.config', () => {
  it('monta uma política por regra, com a retenção configurada na variável da regra', () => {
    const retentionBySetting = new Map(
      RETENTION_RULES.map(({ setting }) => [setting, buildDuration()]),
    );
    const configService = {
      get: vi.fn((setting: string) =>
        retentionBySetting.get(
          setting as (typeof RETENTION_RULES)[number]['setting'],
        ),
      ),
    } as unknown as ConfigService<Environment, true>;

    const policies = buildRetentionPolicies(configService);

    expect(policies).toEqual(
      RETENTION_RULES.map(({ setting, ...rule }) => ({
        ...rule,
        retention: retentionBySetting.get(setting),
      })),
    );
    for (const { setting } of RETENTION_RULES) {
      expect(configService.get).toHaveBeenCalledWith(setting, { infer: true });
    }
  });

  describe('coerência com os schemas Prisma', () => {
    const schemas = readEntitySchemas();

    it.each(RETENTION_RULES.map((rule) => [rule.indexName, rule]))(
      '%s está declarado como índice simples sobre o campo da política',
      (_indexName, { collection, field, indexName }) => {
        expect(schemas).toContain(`@@map("${collection}")`);
        expect(schemas).toMatch(
          new RegExp(`@@index\\(\\[${field}\\],\\s*map:\\s*"${indexName}"\\)`),
        );
      },
    );
  });
});

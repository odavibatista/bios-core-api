import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { buildRetentionPolicies } from '@shared/config/data-retention.config.js';
import type { Environment } from '@shared/config/environment.config.js';
import type { RetentionPolicy } from '@shared/domain/dtos/providers/retention-policy.dto.js';
import { Duration } from '@shared/domain/value-objects/duration.js';
import type { PrismaService } from '@shared/infra/database/prisma.service.js';
import { SyncRetentionIndexesUseCase } from '@shared/infra/usecases/data-retention/sync-retention-indexes.usecase.js';
import { inject } from 'vitest';
import { z } from 'zod';
import { createDatabaseTestingApp } from '../support/database-testing-app.js';
import { faker } from '../support/faker.js';

const ListIndexesResultSchema = z.object({
  cursor: z.object({
    firstBatch: z.array(
      z.object({
        name: z.string(),
        expireAfterSeconds: z.number().optional(),
      }),
    ),
  }),
});

async function expireAfterSecondsOf(
  prisma: PrismaService,
  { collection, indexName }: RetentionPolicy,
): Promise<number | undefined> {
  const result = await prisma.$runCommandRaw({ listIndexes: collection });

  return ListIndexesResultSchema.parse(result).cursor.firstBatch.find(
    ({ name }) => name === indexName,
  )?.expireAfterSeconds;
}

describe.runIf(inject('databaseAvailable'))(
  'Retenção de dados com banco real (e2e)',
  () => {
    let app: INestApplication;
    let prisma: PrismaService;
    let syncRetentionIndexes: SyncRetentionIndexesUseCase;
    let policies: RetentionPolicy[];

    beforeAll(async () => {
      ({ app, prisma } = await createDatabaseTestingApp());
      syncRetentionIndexes = app.get(SyncRetentionIndexesUseCase);
      policies = buildRetentionPolicies(
        app.get<ConfigService<Environment, true>>(ConfigService),
      );
    });

    afterAll(async () => {
      await app.close();
    });

    it('converte em TTL os índices criados pelo schema e é idempotente', async () => {
      const first = await syncRetentionIndexes.execute(policies);

      expect(first.failed).toEqual([]);
      expect(first.updated).toHaveLength(policies.length);

      for (const policy of policies) {
        expect(await expireAfterSecondsOf(prisma, policy)).toBe(
          policy.retention.toSeconds(),
        );
      }

      const second = await syncRetentionIndexes.execute(policies);

      expect(second.unchanged).toHaveLength(policies.length);
    });

    it('altera o prazo de um índice TTL existente sem recriá-lo', async () => {
      const policy = faker.helpers.arrayElement(policies);
      const retention = Duration.ofSeconds(
        policy.retention.toSeconds() +
          faker.number.int({ min: 60, max: 86_400 }),
      );

      const report = await syncRetentionIndexes.execute([
        { ...policy, retention },
      ]);

      expect(report.updated).toEqual([
        `${policy.collection}.${policy.indexName}`,
      ]);
      expect(await expireAfterSecondsOf(prisma, policy)).toBe(
        retention.toSeconds(),
      );
    });
  },
);

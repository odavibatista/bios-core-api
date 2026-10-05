import { Test } from '@nestjs/testing';
import { retentionPolicyFactory } from '@test/factories/shared/retention-policy.factory.js';
import { faker } from '@test/support/faker.js';
import type { RetentionPolicy } from '../../../domain/dtos/providers/retention-policy.dto.js';
import { RetentionIndexProvider } from '../../../domain/providers/retention-index.provider.js';
import { SyncRetentionIndexesUseCase } from './sync-retention-indexes.usecase.js';

function indexOf({ collection, indexName }: RetentionPolicy): string {
  return `${collection}.${indexName}`;
}

describe('SyncRetentionIndexesUseCase', () => {
  const retentionIndexProvider = { apply: vi.fn() };
  let useCase: SyncRetentionIndexesUseCase;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        SyncRetentionIndexesUseCase,
        { provide: RetentionIndexProvider, useValue: retentionIndexProvider },
      ],
    }).compile();

    useCase = moduleRef.get(SyncRetentionIndexesUseCase);
  });

  it('agrupa o resultado de cada política e isola as falhas', async () => {
    const policies = retentionPolicyFactory.buildMany(5);
    const [created, updated, failedWithError, unchanged, failedWithValue] =
      policies;
    const errorMessage = faker.lorem.sentence();
    const thrownValue = faker.lorem.sentence();

    retentionIndexProvider.apply
      .mockResolvedValueOnce('created')
      .mockResolvedValueOnce('updated')
      .mockRejectedValueOnce(new Error(errorMessage))
      .mockResolvedValueOnce('unchanged')
      .mockRejectedValueOnce(thrownValue);

    const report = await useCase.execute(policies);

    expect(report).toEqual({
      created: [indexOf(created)],
      updated: [indexOf(updated)],
      unchanged: [indexOf(unchanged)],
      failed: [
        { index: indexOf(failedWithError), reason: errorMessage },
        { index: indexOf(failedWithValue), reason: thrownValue },
      ],
    });
  });

  it('resume o motivo à linha relevante de erros multilinha do Prisma', async () => {
    const cause = `Raw query failed. Code: \`unknown\`. Message: \`${faker.lorem.sentence()}\``;
    retentionIndexProvider.apply.mockRejectedValueOnce(
      new Error(
        `\nInvalid \`prisma.$runCommandRaw()\` invocation:\n\n\n${cause}\n`,
      ),
    );

    const { failed } = await useCase.execute([retentionPolicyFactory.build()]);

    expect(failed[0].reason).toBe(cause);
  });

  it('retorna relatório vazio sem políticas', async () => {
    await expect(useCase.execute([])).resolves.toEqual({
      created: [],
      updated: [],
      unchanged: [],
      failed: [],
    });
  });
});

import { Test } from '@nestjs/testing';
import type { RetentionPolicy } from '../../../domain/dtos/providers/retention-policy.dto.js';
import { RetentionIndexProvider } from '../../../domain/providers/retention-index.provider.js';
import { Duration } from '../../../domain/value-objects/duration.js';
import { SyncRetentionIndexesUseCase } from './sync-retention-indexes.usecase.js';

function policy(collection: string): RetentionPolicy {
  return {
    collection,
    field: 'created_at',
    indexName: `idx_${collection}_created_at`,
    retention: Duration.parse('30d'),
  };
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
    retentionIndexProvider.apply
      .mockResolvedValueOnce('created')
      .mockResolvedValueOnce('updated')
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce('unchanged')
      .mockRejectedValueOnce('falha sem Error');

    const report = await useCase.execute(['a', 'b', 'c', 'd', 'e'].map(policy));

    expect(report).toEqual({
      created: ['a.idx_a_created_at'],
      updated: ['b.idx_b_created_at'],
      unchanged: ['d.idx_d_created_at'],
      failed: [
        { index: 'c.idx_c_created_at', reason: 'timeout' },
        { index: 'e.idx_e_created_at', reason: 'falha sem Error' },
      ],
    });
  });

  it('resume o motivo à linha relevante de erros multilinha do Prisma', async () => {
    retentionIndexProvider.apply.mockRejectedValueOnce(
      new Error(
        '\nInvalid `prisma.$runCommandRaw()` invocation:\n\n\n' +
          'Raw query failed. Code: `unknown`. Message: `Server selection timeout`\n',
      ),
    );

    const { failed } = await useCase.execute([policy('a')]);

    expect(failed[0].reason).toBe(
      'Raw query failed. Code: `unknown`. Message: `Server selection timeout`',
    );
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

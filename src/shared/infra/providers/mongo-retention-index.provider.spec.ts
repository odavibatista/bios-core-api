import type { RetentionPolicy } from '../../domain/dtos/providers/retention-policy.dto.js';
import { Duration } from '../../domain/value-objects/duration.js';
import type { PrismaService } from '../database/prisma.service.js';
import { MongoRetentionIndexProvider } from './mongo-retention-index.provider.js';

const policy: RetentionPolicy = {
  collection: 'login_attempts',
  field: 'attempted_at',
  indexName: 'idx_login_attempts_attempted_at',
  retention: Duration.parse('90d'),
};

const NINETY_DAYS = 7_776_000;

function listIndexesResult(indexes: object[]) {
  return { cursor: { firstBatch: indexes, id: 0 }, ok: 1 };
}

describe('MongoRetentionIndexProvider', () => {
  const runCommandRaw = vi.fn();
  const provider = new MongoRetentionIndexProvider({
    $runCommandRaw: runCommandRaw,
  } as unknown as PrismaService);

  it('cria o índice já com TTL quando ele não existe', async () => {
    runCommandRaw
      .mockResolvedValueOnce(
        listIndexesResult([{ name: '_id_', key: { _id: 1 } }]),
      )
      .mockResolvedValueOnce({ ok: 1 });

    await expect(provider.apply(policy)).resolves.toBe('created');
    expect(runCommandRaw).toHaveBeenLastCalledWith({
      createIndexes: 'login_attempts',
      indexes: [
        {
          key: { attempted_at: 1 },
          name: 'idx_login_attempts_attempted_at',
          expireAfterSeconds: NINETY_DAYS,
        },
      ],
    });
  });

  it('cria o índice quando a coleção ainda não existe', async () => {
    runCommandRaw
      .mockRejectedValueOnce(
        new Error('Command failed (NamespaceNotFound): ns does not exist'),
      )
      .mockResolvedValueOnce({ ok: 1 });

    await expect(provider.apply(policy)).resolves.toBe('created');
  });

  it('converte em TTL o índice simples criado pelo Prisma', async () => {
    runCommandRaw
      .mockResolvedValueOnce(
        listIndexesResult([
          { name: policy.indexName, key: { attempted_at: 1 } },
        ]),
      )
      .mockResolvedValueOnce({ ok: 1 });

    await expect(provider.apply(policy)).resolves.toBe('updated');
    expect(runCommandRaw).toHaveBeenLastCalledWith({
      collMod: 'login_attempts',
      index: {
        name: 'idx_login_attempts_attempted_at',
        expireAfterSeconds: NINETY_DAYS,
      },
    });
  });

  it('atualiza o prazo de um índice TTL existente', async () => {
    runCommandRaw
      .mockResolvedValueOnce(
        listIndexesResult([
          {
            name: policy.indexName,
            key: { attempted_at: 1 },
            expireAfterSeconds: 3_600,
          },
        ]),
      )
      .mockResolvedValueOnce({ ok: 1 });

    await expect(provider.apply(policy)).resolves.toBe('updated');
  });

  it('não executa nada quando o prazo já é o configurado', async () => {
    runCommandRaw.mockResolvedValueOnce(
      listIndexesResult([
        {
          name: policy.indexName,
          key: { attempted_at: 1 },
          expireAfterSeconds: NINETY_DAYS,
        },
      ]),
    );

    await expect(provider.apply(policy)).resolves.toBe('unchanged');
    expect(runCommandRaw).toHaveBeenCalledOnce();
  });

  it('rejeita índice homônimo sobre outra chave', async () => {
    runCommandRaw.mockResolvedValueOnce(
      listIndexesResult([
        { name: policy.indexName, key: { ip: 1, attempted_at: 1 } },
      ]),
    );

    await expect(provider.apply(policy)).rejects.toThrow(
      /exige índice simples sobre "attempted_at"/,
    );
  });

  it('propaga erros que não sejam de coleção inexistente', async () => {
    runCommandRaw.mockRejectedValueOnce(new Error('connection refused'));

    await expect(provider.apply(policy)).rejects.toThrow('connection refused');
  });
});

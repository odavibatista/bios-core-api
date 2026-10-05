import { retentionPolicyFactory } from '@test/factories/shared/retention-policy.factory.js';
import { faker } from '@test/support/faker.js';
import type { RetentionPolicy } from '../../domain/dtos/providers/retention-policy.dto.js';
import type { PrismaService } from '../database/prisma.service.js';
import { MongoRetentionIndexProvider } from './mongo-retention-index.provider.js';

function listIndexesResult(indexes: object[]) {
  return { cursor: { firstBatch: indexes, id: 0 }, ok: 1 };
}

describe('MongoRetentionIndexProvider', () => {
  const runCommandRaw = vi.fn();
  const provider = new MongoRetentionIndexProvider({
    $runCommandRaw: runCommandRaw,
  } as unknown as PrismaService);

  let policy: RetentionPolicy;
  let expireAfterSeconds: number;

  beforeEach(() => {
    policy = retentionPolicyFactory.build();
    expireAfterSeconds = policy.retention.toSeconds();
  });

  it('cria o índice já com TTL quando ele não existe', async () => {
    runCommandRaw
      .mockResolvedValueOnce(
        listIndexesResult([{ name: '_id_', key: { _id: 1 } }]),
      )
      .mockResolvedValueOnce({ ok: 1 });

    await expect(provider.apply(policy)).resolves.toBe('created');
    expect(runCommandRaw).toHaveBeenLastCalledWith({
      createIndexes: policy.collection,
      indexes: [
        {
          key: { [policy.field]: 1 },
          name: policy.indexName,
          expireAfterSeconds,
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
          { name: policy.indexName, key: { [policy.field]: 1 } },
        ]),
      )
      .mockResolvedValueOnce({ ok: 1 });

    await expect(provider.apply(policy)).resolves.toBe('updated');
    expect(runCommandRaw).toHaveBeenLastCalledWith({
      collMod: policy.collection,
      index: { name: policy.indexName, expireAfterSeconds },
    });
  });

  it('atualiza o prazo de um índice TTL existente', async () => {
    runCommandRaw
      .mockResolvedValueOnce(
        listIndexesResult([
          {
            name: policy.indexName,
            key: { [policy.field]: 1 },
            expireAfterSeconds:
              expireAfterSeconds + faker.number.int({ min: 1, max: 86_400 }),
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
          key: { [policy.field]: 1 },
          expireAfterSeconds,
        },
      ]),
    );

    await expect(provider.apply(policy)).resolves.toBe('unchanged');
    expect(runCommandRaw).toHaveBeenCalledOnce();
  });

  it('rejeita índice homônimo sobre outra chave', async () => {
    const otherField = `${policy.field}_${faker.string.alpha({ length: 4, casing: 'lower' })}`;

    runCommandRaw.mockResolvedValueOnce(
      listIndexesResult([
        { name: policy.indexName, key: { [otherField]: 1, [policy.field]: 1 } },
      ]),
    );

    await expect(provider.apply(policy)).rejects.toThrow(
      `exige índice simples sobre "${policy.field}"`,
    );
  });

  it('propaga erros que não sejam de coleção inexistente', async () => {
    const message = faker.lorem.sentence();
    runCommandRaw.mockRejectedValueOnce(new Error(message));

    await expect(provider.apply(policy)).rejects.toThrow(message);
  });
});

import { Test } from '@nestjs/testing';
import { faker } from '@test/support/faker.js';
import {
  type ActiveApiKey,
  ApiKeyRepository,
} from '../../domain/dtos/repositories/api-key.repository.js';
import { ListApiKeysUseCase } from './list-api-keys.usecase.js';

describe('ListApiKeysUseCase', () => {
  const apiKeyRepository = {
    listActive: vi.fn<ApiKeyRepository['listActive']>(),
  };
  let useCase: ListApiKeysUseCase;

  function buildKey(overrides: Partial<ActiveApiKey> = {}): ActiveApiKey {
    return {
      id: faker.database.mongodbObjectId(),
      name: faker.commerce.productName(),
      prefix: `bios_${faker.string.alphanumeric(8)}`,
      createdAt: faker.date.past(),
      lastUsedAt: null,
      ...overrides,
    };
  }

  beforeEach(async () => {
    apiKeyRepository.listActive.mockResolvedValue([]);

    const moduleRef = await Test.createTestingModule({
      providers: [
        ListApiKeysUseCase,
        { provide: ApiKeyRepository, useValue: apiKeyRepository },
      ],
    }).compile();

    useCase = moduleRef.get(ListApiKeysUseCase);
  });

  it('lista as chaves ativas do usuário informado', async () => {
    const userId = faker.database.mongodbObjectId();

    await useCase.execute(userId);

    expect(apiKeyRepository.listActive).toHaveBeenCalledWith(userId);
  });

  it('devolve lista vazia quando não há chaves', async () => {
    await expect(
      useCase.execute(faker.database.mongodbObjectId()),
    ).resolves.toEqual({ data: [] });
  });

  it('traz identificador, nome, prefixo e datas, em ISO 8601', async () => {
    const used = buildKey({ lastUsedAt: faker.date.recent() });
    const unused = buildKey();
    apiKeyRepository.listActive.mockResolvedValue([used, unused]);

    const { data } = await useCase.execute(faker.database.mongodbObjectId());

    expect(data).toEqual([
      {
        id: used.id,
        name: used.name,
        prefix: used.prefix,
        created_at: used.createdAt.toISOString(),
        last_used_at: used.lastUsedAt?.toISOString(),
      },
      {
        id: unused.id,
        name: unused.name,
        prefix: unused.prefix,
        created_at: unused.createdAt.toISOString(),
        last_used_at: null,
      },
    ]);
  });

  it('mantém a ordem do repositório', async () => {
    const keys = [buildKey(), buildKey(), buildKey()];
    apiKeyRepository.listActive.mockResolvedValue(keys);

    const { data } = await useCase.execute(faker.database.mongodbObjectId());

    expect(data.map(({ id }) => id)).toEqual(keys.map(({ id }) => id));
  });

  it('só expõe os campos da listagem: nem a chave nem o resumo', async () => {
    apiKeyRepository.listActive.mockResolvedValue([buildKey()]);

    const { data } = await useCase.execute(faker.database.mongodbObjectId());

    expect(Object.keys(data[0]).sort()).toEqual([
      'created_at',
      'id',
      'last_used_at',
      'name',
      'prefix',
    ]);
  });
});

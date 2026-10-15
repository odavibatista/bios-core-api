import { Test } from '@nestjs/testing';
import { UserRole } from '@prisma/client';
import type { AuthenticatedUser } from '@shared/domain/dtos/authenticated-user.dto.js';
import { faker } from '@test/support/faker.js';
import { ApiKeyNotFoundException } from '../../domain/dtos/errors/api-key-not-found.exception.js';
import { ApiKeyRepository } from '../../domain/dtos/repositories/api-key.repository.js';
import { RevokeApiKeyUseCase } from './revoke-api-key.usecase.js';

describe('RevokeApiKeyUseCase', () => {
  const apiKeyRepository = { revoke: vi.fn<ApiKeyRepository['revoke']>() };
  const user: AuthenticatedUser = {
    userId: faker.database.mongodbObjectId(),
    sessionId: faker.database.mongodbObjectId(),
    familyId: faker.string.uuid(),
    role: UserRole.USER,
  };
  let useCase: RevokeApiKeyUseCase;

  beforeEach(async () => {
    vi.useFakeTimers({ now: faker.date.recent() });
    apiKeyRepository.revoke.mockResolvedValue(true);

    const moduleRef = await Test.createTestingModule({
      providers: [
        RevokeApiKeyUseCase,
        { provide: ApiKeyRepository, useValue: apiKeyRepository },
      ],
    }).compile();

    useCase = moduleRef.get(RevokeApiKeyUseCase);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('revoga a chave do usuário, no instante do pedido', async () => {
    const apiKeyId = faker.database.mongodbObjectId();

    await expect(useCase.execute({ user, apiKeyId })).resolves.toBeUndefined();

    expect(apiKeyRepository.revoke).toHaveBeenCalledWith(
      user.userId,
      apiKeyId,
      new Date(),
    );
  });

  it('passa o usuário autenticado ao repositório: a posse faz parte da escrita', async () => {
    await useCase.execute({
      user,
      apiKeyId: faker.database.mongodbObjectId(),
    });

    const [userId] = apiKeyRepository.revoke.mock.calls[0];
    expect(userId).toBe(user.userId);
  });

  it('recusa como "não encontrada" a chave que não é do usuário, que não existe ou que já foi revogada', async () => {
    apiKeyRepository.revoke.mockResolvedValue(false);

    await expect(
      useCase.execute({ user, apiKeyId: faker.database.mongodbObjectId() }),
    ).rejects.toBeInstanceOf(ApiKeyNotFoundException);
  });

  it.each([
    ['vazio', ''],
    ['curto demais', 'abc123'],
    ['longo demais', 'a'.repeat(25)],
    ['fora do hexadecimal', 'z'.repeat(24)],
    ['com caractere de URL', '../'.repeat(8)],
  ])(
    'recusa o identificador malformado (%s) sem tocar no banco',
    async (_case, apiKeyId) => {
      await expect(useCase.execute({ user, apiKeyId })).rejects.toBeInstanceOf(
        ApiKeyNotFoundException,
      );

      expect(apiKeyRepository.revoke).not.toHaveBeenCalled();
    },
  );

  it('aceita o identificador em maiúsculas', async () => {
    await useCase.execute({
      user,
      apiKeyId: faker.database.mongodbObjectId().toUpperCase(),
    });

    expect(apiKeyRepository.revoke).toHaveBeenCalled();
  });

  it('propaga a falha do banco', async () => {
    apiKeyRepository.revoke.mockRejectedValue(new Error('banco fora'));

    await expect(
      useCase.execute({ user, apiKeyId: faker.database.mongodbObjectId() }),
    ).rejects.toThrow('banco fora');
  });
});

import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { UserRole } from '@prisma/client';
import type { AuthenticatedUser } from '@shared/domain/dtos/authenticated-user.dto.js';
import { IS_PUBLIC_ROUTE } from '@shared/http/decorators/public.decorator.js';
import { faker } from '@test/support/faker.js';
import { CreateApiKeyUseCase } from '../../infra/usecases/create-api-key.usecase.js';
import { ListApiKeysUseCase } from '../../infra/usecases/list-api-keys.usecase.js';
import { RevokeApiKeyUseCase } from '../../infra/usecases/revoke-api-key.usecase.js';
import { ApiKeysController } from './api-keys.controller.js';

describe('ApiKeysController', () => {
  const createApiKey = { execute: vi.fn() };
  const listApiKeys = { execute: vi.fn() };
  const revokeApiKey = { execute: vi.fn() };
  const user: AuthenticatedUser = {
    userId: faker.database.mongodbObjectId(),
    sessionId: faker.database.mongodbObjectId(),
    familyId: faker.string.uuid(),
    role: UserRole.USER,
  };
  let controller: ApiKeysController;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ApiKeysController],
      providers: [
        { provide: CreateApiKeyUseCase, useValue: createApiKey },
        { provide: ListApiKeysUseCase, useValue: listApiKeys },
        { provide: RevokeApiKeyUseCase, useValue: revokeApiKey },
      ],
    }).compile();

    controller = moduleRef.get(ApiKeysController);
  });

  it('create: gera a chave para o usuário autenticado e a devolve', async () => {
    const created = { key: 'bios_x', id: faker.database.mongodbObjectId() };
    createApiKey.execute.mockResolvedValue(created);

    await expect(controller.create({ name: 'Meu CRM' }, user)).resolves.toBe(
      created,
    );

    expect(createApiKey.execute).toHaveBeenCalledWith({
      user,
      request: { name: 'Meu CRM' },
    });
  });

  it('list: lista as chaves do usuário autenticado', async () => {
    const list = { data: [] };
    listApiKeys.execute.mockResolvedValue(list);

    await expect(controller.list(user)).resolves.toBe(list);

    expect(listApiKeys.execute).toHaveBeenCalledWith(user.userId);
  });

  it('revoke: revoga a chave indicada na rota, em nome do usuário autenticado', async () => {
    revokeApiKey.execute.mockResolvedValue(undefined);
    const apiKeyId = faker.database.mongodbObjectId();

    await expect(controller.revoke(apiKeyId, user)).resolves.toBeUndefined();

    expect(revokeApiKey.execute).toHaveBeenCalledWith({ user, apiKeyId });
  });

  it.each([
    ['create', () => createApiKey],
    ['list', () => listApiKeys],
    ['revoke', () => revokeApiKey],
  ] as const)(
    '%s: propaga a recusa do caso de uso',
    async (method, useCase) => {
      useCase().execute.mockRejectedValue(new Error('recusado'));

      await expect(
        method === 'create'
          ? controller.create({ name: 'Nome' }, user)
          : method === 'list'
            ? controller.list(user)
            : controller.revoke(faker.database.mongodbObjectId(), user),
      ).rejects.toThrow('recusado');
    },
  );

  it('exige sessão em todas as rotas: gerenciar chaves não é público', () => {
    const reflector = new Reflector();

    for (const method of ['create', 'list', 'revoke'] as const) {
      expect(
        reflector.get<boolean | undefined>(
          IS_PUBLIC_ROUTE,
          ApiKeysController.prototype[method],
        ),
      ).toBeUndefined();
    }
    expect(
      reflector.get<boolean | undefined>(IS_PUBLIC_ROUTE, ApiKeysController),
    ).toBeUndefined();
  });
});

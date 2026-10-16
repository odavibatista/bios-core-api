import type { ExecutionContext } from '@nestjs/common';
import { API_KEY_HEADER } from '@shared/config/throttler.config.js';
import { faker } from '@test/support/faker.js';
import { InvalidApiKeyException } from '../../domain/dtos/errors/invalid-api-key.exception.js';
import type { AuthenticateApiKeyUseCase } from '../../infra/usecases/authenticate-api-key.usecase.js';
import { ApiKeyGuard } from './api-key.guard.js';

describe('ApiKeyGuard', () => {
  const authenticate = { execute: vi.fn() };
  const guard = new ApiKeyGuard(
    authenticate as unknown as AuthenticateApiKeyUseCase,
  );

  const contextOf = (headers: Record<string, unknown>) =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ headers }) }),
    }) as unknown as ExecutionContext;

  beforeEach(() => {
    authenticate.execute.mockResolvedValue({
      apiKeyId: faker.database.mongodbObjectId(),
      userId: faker.database.mongodbObjectId(),
    });
  });

  it('libera a chamada cuja chave o caso de uso autentica', async () => {
    const key = faker.string.alphanumeric(60);

    await expect(
      guard.canActivate(contextOf({ [API_KEY_HEADER]: key })),
    ).resolves.toBe(true);

    expect(authenticate.execute).toHaveBeenCalledWith(key);
  });

  it('entrega a chave sem espaços nas bordas', async () => {
    const key = faker.string.alphanumeric(60);

    await guard.canActivate(contextOf({ [API_KEY_HEADER]: `  ${key}  ` }));

    expect(authenticate.execute).toHaveBeenCalledWith(key);
  });

  it('entrega undefined quando a chamada não traz o cabeçalho', async () => {
    authenticate.execute.mockRejectedValue(new InvalidApiKeyException());

    await expect(guard.canActivate(contextOf({}))).rejects.toBeInstanceOf(
      InvalidApiKeyException,
    );

    expect(authenticate.execute).toHaveBeenCalledWith(undefined);
  });

  it('propaga a recusa do caso de uso', async () => {
    authenticate.execute.mockRejectedValue(new InvalidApiKeyException());

    await expect(
      guard.canActivate(contextOf({ [API_KEY_HEADER]: 'qualquer' })),
    ).rejects.toBeInstanceOf(InvalidApiKeyException);
  });
});

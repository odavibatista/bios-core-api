import { Test } from '@nestjs/testing';
import { UserRole } from '@prisma/client';
import type { AuthenticatedUser } from '@shared/domain/dtos/authenticated-user.dto.js';
import { OpaqueTokenProvider } from '@shared/domain/providers/opaque-token.provider.js';
import { faker } from '@test/support/faker.js';
import { parseApiKey } from '../../domain/api-key-format.js';
import { ApiKeyLimitReachedException } from '../../domain/dtos/errors/api-key-limit-reached.exception.js';
import {
  type ActiveApiKey,
  ApiKeyRepository,
} from '../../domain/dtos/repositories/api-key.repository.js';
import {
  CreateApiKeyUseCase,
  MAX_ACTIVE_API_KEYS_PER_USER,
} from './create-api-key.usecase.js';

describe('CreateApiKeyUseCase', () => {
  const apiKeyRepository = {
    countActive: vi.fn<ApiKeyRepository['countActive']>(),
    create: vi.fn<ApiKeyRepository['create']>(),
  };
  const user: AuthenticatedUser = {
    userId: faker.database.mongodbObjectId(),
    sessionId: faker.database.mongodbObjectId(),
    familyId: faker.string.uuid(),
    role: UserRole.USER,
  };
  let tokenCounter = 0;
  let useCase: CreateApiKeyUseCase;

  /** Simula um gerador determinístico: cada chamada devolve um token novo. */
  const opaqueTokenProvider = {
    generate: vi.fn(() => {
      tokenCounter += 1;
      const token = `${String(tokenCounter).padStart(8, '0')}${'x'.repeat(35)}`;

      return { token, hash: `hash-do-token-${tokenCounter}` };
    }),
    /** Resumo simulado: determinístico, mas sem conter o valor original. */
    hash: vi.fn((value: string) => `digest:${[...value].reverse().join('')}`),
  };

  function persisted(overrides: Partial<ActiveApiKey> = {}): ActiveApiKey {
    return {
      id: faker.database.mongodbObjectId(),
      name: 'Integração',
      prefix: 'bios_xxxxxxxx',
      createdAt: faker.date.recent(),
      lastUsedAt: null,
      ...overrides,
    };
  }

  beforeEach(async () => {
    tokenCounter = 0;
    apiKeyRepository.countActive.mockResolvedValue(0);
    apiKeyRepository.create.mockImplementation(({ name, prefix }) =>
      Promise.resolve(persisted({ name, prefix })),
    );

    const moduleRef = await Test.createTestingModule({
      providers: [
        CreateApiKeyUseCase,
        { provide: ApiKeyRepository, useValue: apiKeyRepository },
        { provide: OpaqueTokenProvider, useValue: opaqueTokenProvider },
      ],
    }).compile();

    useCase = moduleRef.get(CreateApiKeyUseCase);
  });

  it('devolve a chave completa no formato bios_<identificador>_<segredo>', async () => {
    const created = await useCase.execute({
      user,
      request: { name: 'Integração' },
    });

    expect(parseApiKey(created.key)).not.toBeNull();
  });

  it('devolve o prefixo público, que é o início da chave', async () => {
    const created = await useCase.execute({
      user,
      request: { name: 'Integração' },
    });

    expect(created.key.startsWith(created.prefix)).toBe(true);
    expect(parseApiKey(created.key)).toBe(created.prefix);
  });

  it('grava só o resumo da chave completa, nunca o valor', async () => {
    const created = await useCase.execute({
      user,
      request: { name: 'Integração' },
    });

    const [saved] = apiKeyRepository.create.mock.calls[0];
    expect(opaqueTokenProvider.hash).toHaveBeenCalledWith(created.key);
    expect(saved.hash).toBe(opaqueTokenProvider.hash(created.key));
    expect(JSON.stringify(saved)).not.toContain(created.key);
  });

  it('registra a chave para o usuário, com o nome informado', async () => {
    await useCase.execute({ user, request: { name: 'Meu CRM' } });

    expect(apiKeyRepository.create).toHaveBeenCalledWith({
      userId: user.userId,
      name: 'Meu CRM',
      prefix: expect.stringMatching(/^bios_[A-Za-z0-9]{8}$/),
      hash: expect.any(String),
    });
  });

  it('o identificador público é alfanumérico, mesmo que o token traga hífen e sublinhado', async () => {
    opaqueTokenProvider.generate.mockReturnValueOnce({
      token: `-_-_-_-_A1b2C3d4${'x'.repeat(27)}`,
      hash: 'h',
    });

    const created = await useCase.execute({
      user,
      request: { name: 'Integração' },
    });

    expect(created.prefix).toMatch(/^bios_[A-Za-z0-9]{8}$/);
  });

  it('a chave recém-gerada nunca foi usada', async () => {
    const created = await useCase.execute({
      user,
      request: { name: 'Integração' },
    });

    expect(created.last_used_at).toBeNull();
  });

  it('gera chaves diferentes a cada chamada', async () => {
    const first = await useCase.execute({ user, request: { name: 'A' } });
    const second = await useCase.execute({ user, request: { name: 'B' } });

    expect(first.key).not.toBe(second.key);
    expect(first.prefix).not.toBe(second.prefix);
  });

  describe('teto de chaves ativas', () => {
    it('recusa quando o usuário já tem o máximo, sem gerar nada', async () => {
      apiKeyRepository.countActive.mockResolvedValue(
        MAX_ACTIVE_API_KEYS_PER_USER,
      );

      await expect(
        useCase.execute({ user, request: { name: 'Mais uma' } }),
      ).rejects.toBeInstanceOf(ApiKeyLimitReachedException);

      expect(apiKeyRepository.create).not.toHaveBeenCalled();
    });

    it('aceita a última vaga', async () => {
      apiKeyRepository.countActive.mockResolvedValue(
        MAX_ACTIVE_API_KEYS_PER_USER - 1,
      );

      await expect(
        useCase.execute({ user, request: { name: 'Última' } }),
      ).resolves.toBeDefined();
    });

    it('conta só as chaves do próprio usuário', async () => {
      await useCase.execute({ user, request: { name: 'Integração' } });

      expect(apiKeyRepository.countActive).toHaveBeenCalledWith(user.userId);
    });
  });

  describe('colisão de identificador', () => {
    it('gera outro quando o banco recusa por duplicidade', async () => {
      apiKeyRepository.create
        .mockResolvedValueOnce(null)
        .mockImplementation(({ name, prefix }) =>
          Promise.resolve(persisted({ name, prefix })),
        );

      const created = await useCase.execute({
        user,
        request: { name: 'Integração' },
      });

      expect(apiKeyRepository.create).toHaveBeenCalledTimes(2);
      const [first, second] = apiKeyRepository.create.mock.calls.map(
        ([key]) => key.prefix,
      );
      expect(first).not.toBe(second);
      expect(created.prefix).toBe(second);
    });

    it('desiste depois de três colisões seguidas', async () => {
      apiKeyRepository.create.mockResolvedValue(null);

      await expect(
        useCase.execute({ user, request: { name: 'Integração' } }),
      ).rejects.toThrow(/identificador único/);

      expect(apiKeyRepository.create).toHaveBeenCalledTimes(3);
    });
  });

  it('propaga a falha do banco', async () => {
    apiKeyRepository.create.mockRejectedValue(new Error('banco fora'));

    await expect(
      useCase.execute({ user, request: { name: 'Integração' } }),
    ).rejects.toThrow('banco fora');
  });
});

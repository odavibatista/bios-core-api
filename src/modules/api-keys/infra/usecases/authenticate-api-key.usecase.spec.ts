import { Test } from '@nestjs/testing';
import { OpaqueTokenProvider } from '@shared/domain/providers/opaque-token.provider.js';
import { faker } from '@test/support/faker.js';
import { buildApiKey } from '../../domain/api-key-format.js';
import { InvalidApiKeyException } from '../../domain/dtos/errors/invalid-api-key.exception.js';
import {
  type ApiKeyCredential,
  ApiKeyRepository,
} from '../../domain/dtos/repositories/api-key.repository.js';
import {
  AuthenticateApiKeyUseCase,
  LAST_USED_PRECISION_MS,
} from './authenticate-api-key.usecase.js';

describe('AuthenticateApiKeyUseCase', () => {
  const apiKeyRepository = {
    findActiveByPrefix: vi.fn<ApiKeyRepository['findActiveByPrefix']>(),
    markUsed: vi.fn<ApiKeyRepository['markUsed']>(),
  };
  /** Resumo simulado: determinístico e sem relação com a chave original. */
  const opaqueTokenProvider = {
    hash: vi.fn((value: string) => `digest:${[...value].reverse().join('')}`),
  };
  const publicId = faker.string.alphanumeric(8);
  const secret = faker.string.alphanumeric(43);
  const apiKey = buildApiKey(publicId, secret);
  const prefix = `bios_${publicId}`;
  let credential: ApiKeyCredential;
  let useCase: AuthenticateApiKeyUseCase;

  beforeEach(async () => {
    vi.useFakeTimers({ now: faker.date.recent() });
    credential = {
      id: faker.database.mongodbObjectId(),
      userId: faker.database.mongodbObjectId(),
      hash: opaqueTokenProvider.hash(apiKey),
    };
    apiKeyRepository.findActiveByPrefix.mockResolvedValue(credential);
    apiKeyRepository.markUsed.mockResolvedValue(undefined);

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthenticateApiKeyUseCase,
        { provide: ApiKeyRepository, useValue: apiKeyRepository },
        { provide: OpaqueTokenProvider, useValue: opaqueTokenProvider },
      ],
    }).compile();

    useCase = moduleRef.get(AuthenticateApiKeyUseCase);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('autentica a chave válida e devolve quem ela é e de quem', async () => {
    await expect(useCase.execute(apiKey)).resolves.toEqual({
      apiKeyId: credential.id,
      userId: credential.userId,
    });
  });

  it('localiza a chave pelo prefixo público', async () => {
    await useCase.execute(apiKey);

    expect(apiKeyRepository.findActiveByPrefix).toHaveBeenCalledWith(prefix);
  });

  it('descarta espaços nas bordas antes de conferir', async () => {
    await expect(useCase.execute(`  ${apiKey} `)).resolves.toMatchObject({
      apiKeyId: credential.id,
    });
  });

  describe('chave recusada', () => {
    it.each([
      ['ausente', undefined],
      ['vazia', ''],
      ['sem o formato de chave', 'qualquer-coisa'],
      ['com identificador curto', `bios_abc_${secret}`],
      ['com segredo curto', `bios_${publicId}_curto`],
      ['de outro produto', `outro_${publicId}_${secret}`],
    ])('recusa chave %s sem consultar o banco', async (_case, value) => {
      await expect(useCase.execute(value)).rejects.toBeInstanceOf(
        InvalidApiKeyException,
      );

      expect(apiKeyRepository.findActiveByPrefix).not.toHaveBeenCalled();
      expect(apiKeyRepository.markUsed).not.toHaveBeenCalled();
    });

    it('recusa o prefixo desconhecido ou de chave revogada', async () => {
      apiKeyRepository.findActiveByPrefix.mockResolvedValue(null);

      await expect(useCase.execute(apiKey)).rejects.toBeInstanceOf(
        InvalidApiKeyException,
      );
      expect(apiKeyRepository.markUsed).not.toHaveBeenCalled();
    });

    it('recusa o segredo errado de um prefixo existente', async () => {
      const wrongSecret = buildApiKey(publicId, faker.string.alphanumeric(43));

      await expect(useCase.execute(wrongSecret)).rejects.toBeInstanceOf(
        InvalidApiKeyException,
      );
      expect(apiKeyRepository.markUsed).not.toHaveBeenCalled();
    });

    it('recusa quando o resumo guardado tem outro tamanho, sem lançar erro de comparação', async () => {
      apiKeyRepository.findActiveByPrefix.mockResolvedValue({
        ...credential,
        hash: 'curto',
      });

      await expect(useCase.execute(apiKey)).rejects.toBeInstanceOf(
        InvalidApiKeyException,
      );
    });

    it('calcula o resumo mesmo para o prefixo desconhecido, para não responder mais depressa', async () => {
      apiKeyRepository.findActiveByPrefix.mockResolvedValue(null);

      await useCase.execute(apiKey).catch(() => undefined);

      expect(opaqueTokenProvider.hash).toHaveBeenCalledWith(apiKey);
    });

    it('dá a mesma recusa para todos os motivos', async () => {
      const refusalOf = async (value: string) => {
        try {
          await useCase.execute(value);
        } catch (error) {
          return error instanceof InvalidApiKeyException
            ? error.getResponse()
            : undefined;
        }

        return undefined;
      };

      apiKeyRepository.findActiveByPrefix.mockResolvedValueOnce(null);
      const unknown = await refusalOf(apiKey);
      const wrongSecret = await refusalOf(
        buildApiKey(publicId, faker.string.alphanumeric(43)),
      );
      const malformed = await refusalOf('lixo');

      expect(unknown).toBeDefined();
      expect(wrongSecret).toEqual(unknown);
      expect(malformed).toEqual(unknown);
    });
  });

  describe('registro do último uso', () => {
    it('registra o uso no instante da chamada, com a janela de precisão', async () => {
      await useCase.execute(apiKey);

      const now = new Date();
      expect(apiKeyRepository.markUsed).toHaveBeenCalledWith(
        credential.id,
        now,
        new Date(now.getTime() - LAST_USED_PRECISION_MS),
      );
    });

    it('a falha ao registrar o uso não derruba a chamada legítima', async () => {
      apiKeyRepository.markUsed.mockRejectedValue(new Error('banco fora'));

      await expect(useCase.execute(apiKey)).resolves.toMatchObject({
        apiKeyId: credential.id,
      });
    });

    it('trata a falha que não é Error', async () => {
      apiKeyRepository.markUsed.mockRejectedValue('texto solto');

      await expect(useCase.execute(apiKey)).resolves.toBeDefined();
    });
  });

  it('propaga a falha de busca no banco: indisponível não é "chave inválida"', async () => {
    apiKeyRepository.findActiveByPrefix.mockRejectedValue(
      new Error('banco fora'),
    );

    await expect(useCase.execute(apiKey)).rejects.toThrow('banco fora');
  });
});

import { Test } from '@nestjs/testing';
import { EvidenceSignal, EvidenceState } from '@prisma/client';
import { ResolveEvidenceSourceUseCase } from '@modules/data-sources/infra/usecases/evidence/resolve-evidence-source.usecase.js';
import { ResolveSourceCacheTtlUseCase } from '@modules/data-sources/infra/usecases/cache/resolve-source-cache-ttl.usecase.js';
import { buildCnpj } from '@test/factories/companies/company-profile.factory.js';
import { evidenceSourceFactory } from '@test/factories/evidences/evidence.factory.js';
import { faker } from '@test/support/faker.js';
import { EvidenceCategory } from '@prisma/client';
import {
  EvidenceSourceNotFoundError,
  InvalidEvidenceError,
} from '../../domain/dtos/errors/evidence.errors.js';
import {
  EvidenceRepository,
  type EvidenceToSave,
} from '../../domain/dtos/repositories/evidence.repository.js';
import { UNKNOWN_RETRY_WINDOW_SECONDS } from '../../domain/evidence-rules.js';
import { RecordEvidenceCollectionUseCase } from './record-evidence-collection.usecase.js';

describe('RecordEvidenceCollectionUseCase', () => {
  const evidenceRepository = {
    save: vi.fn<EvidenceRepository['save']>(),
    deleteOthers: vi.fn<EvidenceRepository['deleteOthers']>(),
    hasAnsweredCollection: vi.fn<EvidenceRepository['hasAnsweredCollection']>(),
  };
  const resolveEvidenceSource = {
    execute: vi.fn<ResolveEvidenceSourceUseCase['execute']>(),
  };
  const resolveSourceCacheTtl = {
    execute: vi.fn<ResolveSourceCacheTtlUseCase['execute']>(),
  };
  let useCase: RecordEvidenceCollectionUseCase;

  const cnpj = buildCnpj();
  const collectedAt = faker.date.recent();
  const TTL_SECONDS = 2 * 86_400;
  const source = evidenceSourceFactory.build({
    slug: 'IBAMA',
    category: EvidenceCategory.INFRACAO_AMBIENTAL,
  });

  function savedEvidences(): EvidenceToSave[] {
    return evidenceRepository.save.mock.calls.map(([evidence]) => evidence);
  }

  beforeEach(async () => {
    evidenceRepository.save.mockResolvedValue(undefined);
    evidenceRepository.deleteOthers.mockResolvedValue(0);
    evidenceRepository.hasAnsweredCollection.mockResolvedValue(false);
    resolveEvidenceSource.execute.mockResolvedValue(source);
    resolveSourceCacheTtl.execute.mockResolvedValue(TTL_SECONDS);

    const moduleRef = await Test.createTestingModule({
      providers: [
        RecordEvidenceCollectionUseCase,
        { provide: EvidenceRepository, useValue: evidenceRepository },
        {
          provide: ResolveEvidenceSourceUseCase,
          useValue: resolveEvidenceSource,
        },
        {
          provide: ResolveSourceCacheTtlUseCase,
          useValue: resolveSourceCacheTtl,
        },
      ],
    }).compile();

    useCase = moduleRef.get(RecordEvidenceCollectionUseCase);
  });

  describe('a fonte respondeu com registros', () => {
    const findings = [
      {
        reference: 'AI-1',
        summary: 'Multa por desmatamento',
        url: 'https://dados.example/ai-1',
        details: { valor: 1_000 },
        publishedAt: new Date('2025-03-01T00:00:00.000Z'),
        rawEvidenceId: faker.database.mongodbObjectId(),
      },
      { reference: 'AI-2' },
    ];

    it('cria uma evidência CONFIRMED por registro, com categoria e ODS do catálogo', async () => {
      await useCase.execute({
        cnpj,
        sourceSlug: 'IBAMA',
        collectedAt,
        result: { status: 'COLLECTED', findings },
      });

      expect(savedEvidences()).toEqual([
        {
          key: `IBAMA:${cnpj}:AI-1`,
          cnpj,
          dataSourceId: source.id,
          odsId: source.odsId,
          category: EvidenceCategory.INFRACAO_AMBIENTAL,
          state: EvidenceState.CONFIRMED,
          signal: EvidenceSignal.NEGATIVE,
          summary: 'Multa por desmatamento',
          sourceReference: 'AI-1',
          sourceUrl: 'https://dados.example/ai-1',
          details: { valor: 1_000 },
          publishedAt: new Date('2025-03-01T00:00:00.000Z'),
          collectedAt,
          validUntil: new Date(collectedAt.getTime() + TTL_SECONDS * 1_000),
          rawEvidenceId: findings[0].rawEvidenceId,
        },
        expect.objectContaining({
          key: `IBAMA:${cnpj}:AI-2`,
          summary: null,
          sourceUrl: null,
          details: null,
          publishedAt: null,
          rawEvidenceId: null,
        }),
      ]);
    });

    it('a validade é a janela da fonte no catálogo', async () => {
      await useCase.execute({
        cnpj,
        sourceSlug: 'IBAMA',
        collectedAt,
        result: { status: 'COLLECTED', findings },
      });

      expect(resolveSourceCacheTtl.execute).toHaveBeenCalledWith('IBAMA');
    });

    it('remove da fonte o que a coleta não lista mais (inclusive NOT_FOUND e UNKNOWN antigos)', async () => {
      evidenceRepository.deleteOthers.mockResolvedValue(3);

      const output = await useCase.execute({
        cnpj,
        sourceSlug: 'IBAMA',
        result: { status: 'COLLECTED', findings },
      });

      expect(evidenceRepository.deleteOthers).toHaveBeenCalledWith(
        cnpj,
        source.id,
        [`IBAMA:${cnpj}:AI-1`, `IBAMA:${cnpj}:AI-2`],
      );
      expect(output).toEqual({ saved: 2, removed: 3 });
    });

    it('sem informar a data, coleta agora', async () => {
      vi.useFakeTimers({ now: collectedAt });

      await useCase.execute({
        cnpj,
        sourceSlug: 'IBAMA',
        result: { status: 'COLLECTED', findings },
      });

      expect(savedEvidences()[0].collectedAt).toEqual(collectedAt);
      vi.useRealTimers();
    });

    it('o sinal vem da categoria da fonte', async () => {
      resolveEvidenceSource.execute.mockResolvedValue({
        ...source,
        slug: 'GHG_PROTOCOL',
        category: EvidenceCategory.EMISSAO_GEE,
      });

      await useCase.execute({
        cnpj,
        sourceSlug: 'GHG_PROTOCOL',
        result: { status: 'COLLECTED', findings: [{ reference: '2024' }] },
      });

      expect(savedEvidences()[0]).toMatchObject({
        category: EvidenceCategory.EMISSAO_GEE,
        signal: EvidenceSignal.POSITIVE,
      });
    });

    it('a referência repetida na coleta vale uma vez só (a última)', async () => {
      await useCase.execute({
        cnpj,
        sourceSlug: 'IBAMA',
        result: {
          status: 'COLLECTED',
          findings: [
            { reference: 'AI-1', summary: 'primeira' },
            { reference: ' AI-1 ', summary: 'segunda' },
          ],
        },
      });

      expect(savedEvidences()).toHaveLength(1);
      expect(savedEvidences()[0]).toMatchObject({
        sourceReference: 'AI-1',
        summary: 'segunda',
      });
    });

    it('a mesma referência com identidades diferentes são evidências diferentes', async () => {
      await useCase.execute({
        cnpj,
        sourceSlug: 'IBAMA',
        result: {
          status: 'COLLECTED',
          findings: [
            { reference: '9185894-E', identity: 'AI-1' },
            { reference: '9185894-E', identity: 'AI-2' },
          ],
        },
      });

      expect(savedEvidences().map(({ key }) => key)).toEqual([
        `IBAMA:${cnpj}:AI-1`,
        `IBAMA:${cnpj}:AI-2`,
      ]);
      expect(
        savedEvidences().every(
          ({ sourceReference }) => sourceReference === '9185894-E',
        ),
      ).toBe(true);
    });

    it.each(['', '   '])(
      'recusa o registro sem referência ("%s"), sem gravar nada',
      async (reference) => {
        await expect(
          useCase.execute({
            cnpj,
            sourceSlug: 'IBAMA',
            result: {
              status: 'COLLECTED',
              findings: [{ reference: 'AI-1' }, { reference }],
            },
          }),
        ).rejects.toBeInstanceOf(InvalidEvidenceError);

        expect(evidenceRepository.save).not.toHaveBeenCalled();
        expect(evidenceRepository.deleteOthers).not.toHaveBeenCalled();
      },
    );
  });

  describe('a fonte respondeu sem registro', () => {
    it('grava um NOT_FOUND no lugar das evidências anteriores da fonte', async () => {
      evidenceRepository.deleteOthers.mockResolvedValue(2);

      const output = await useCase.execute({
        cnpj,
        sourceSlug: 'IBAMA',
        collectedAt,
        result: { status: 'COLLECTED', findings: [] },
      });

      expect(savedEvidences()).toEqual([
        {
          key: `IBAMA:${cnpj}#NOT_FOUND`,
          cnpj,
          dataSourceId: source.id,
          odsId: source.odsId,
          category: EvidenceCategory.INFRACAO_AMBIENTAL,
          state: EvidenceState.NOT_FOUND,
          signal: EvidenceSignal.NEGATIVE,
          summary: null,
          sourceReference: null,
          sourceUrl: null,
          details: null,
          publishedAt: null,
          collectedAt,
          validUntil: new Date(collectedAt.getTime() + TTL_SECONDS * 1_000),
          rawEvidenceId: null,
        },
      ]);
      expect(evidenceRepository.deleteOthers).toHaveBeenCalledWith(
        cnpj,
        source.id,
        [`IBAMA:${cnpj}#NOT_FOUND`],
      );
      expect(output).toEqual({ saved: 1, removed: 2 });
    });
  });

  describe('a fonte não respondeu', () => {
    it('sem coleta anterior, grava UNKNOWN com janela curta de nova tentativa', async () => {
      const output = await useCase.execute({
        cnpj,
        sourceSlug: 'IBAMA',
        collectedAt,
        result: { status: 'UNAVAILABLE' },
      });

      expect(savedEvidences()).toEqual([
        expect.objectContaining({
          key: `IBAMA:${cnpj}#UNKNOWN`,
          state: EvidenceState.UNKNOWN,
          collectedAt,
          validUntil: new Date(
            collectedAt.getTime() + UNKNOWN_RETRY_WINDOW_SECONDS * 1_000,
          ),
        }),
      ]);
      expect(output).toEqual({ saved: 1, removed: 0 });
      expect(resolveSourceCacheTtl.execute).not.toHaveBeenCalled();
    });

    it('um UNKNOWN antigo é o único que a coleta pode substituir', async () => {
      await useCase.execute({
        cnpj,
        sourceSlug: 'IBAMA',
        result: { status: 'UNAVAILABLE' },
      });

      expect(evidenceRepository.deleteOthers).toHaveBeenCalledWith(
        cnpj,
        source.id,
        [`IBAMA:${cnpj}#UNKNOWN`],
      );
    });

    it('com coleta anterior que respondeu, não apaga nem grava nada', async () => {
      evidenceRepository.hasAnsweredCollection.mockResolvedValue(true);

      const output = await useCase.execute({
        cnpj,
        sourceSlug: 'IBAMA',
        result: { status: 'UNAVAILABLE' },
      });

      expect(evidenceRepository.hasAnsweredCollection).toHaveBeenCalledWith(
        cnpj,
        source.id,
      );
      expect(evidenceRepository.save).not.toHaveBeenCalled();
      expect(evidenceRepository.deleteOthers).not.toHaveBeenCalled();
      expect(output).toEqual({ saved: 0, removed: 0 });
    });
  });

  describe('entradas inválidas', () => {
    it('recusa a fonte que não é de evidências, sem gravar', async () => {
      resolveEvidenceSource.execute.mockResolvedValue(null);

      await expect(
        useCase.execute({
          cnpj,
          sourceSlug: 'BRASIL_API',
          result: { status: 'COLLECTED', findings: [] },
        }),
      ).rejects.toBeInstanceOf(EvidenceSourceNotFoundError);

      expect(evidenceRepository.save).not.toHaveBeenCalled();
    });

    it.each(['11.222.333/0001-81', '11222333000182', '123', ''])(
      'recusa o CNPJ não canônico ou inválido "%s"',
      async (invalid) => {
        await expect(
          useCase.execute({
            cnpj: invalid,
            sourceSlug: 'IBAMA',
            result: { status: 'COLLECTED', findings: [] },
          }),
        ).rejects.toBeInstanceOf(InvalidEvidenceError);

        expect(resolveEvidenceSource.execute).not.toHaveBeenCalled();
        expect(evidenceRepository.save).not.toHaveBeenCalled();
      },
    );
  });

  describe('falhas', () => {
    it('propaga a falha ao gravar, sem remover nada (a fila repete)', async () => {
      evidenceRepository.save.mockRejectedValue(new Error('banco fora'));

      await expect(
        useCase.execute({
          cnpj,
          sourceSlug: 'IBAMA',
          result: { status: 'COLLECTED', findings: [{ reference: 'AI-1' }] },
        }),
      ).rejects.toThrow('banco fora');

      expect(evidenceRepository.deleteOthers).not.toHaveBeenCalled();
    });
  });
});

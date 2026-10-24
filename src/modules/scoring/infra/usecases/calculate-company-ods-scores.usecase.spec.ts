import { Test } from '@nestjs/testing';
import {
  EvidenceCategory,
  EvidenceSignal,
  EvidenceState,
} from '@prisma/client';
import { ListCompanyEvidencesUseCase } from '@modules/evidences/infra/usecases/list-company-evidences.usecase.js';
import { buildCnpj } from '@test/factories/companies/company-profile.factory.js';
import { storedEvidenceFactory } from '@test/factories/evidences/evidence.factory.js';
import { faker } from '@test/support/faker.js';
import { ScoringNotConfiguredError } from '../../domain/dtos/errors/scoring-not-configured.error.js';
import { OdsScoreRepository } from '../../domain/dtos/repositories/ods-score.repository.js';
import { CalculateCompanyOdsScoresUseCase } from './calculate-company-ods-scores.usecase.js';

describe('CalculateCompanyOdsScoresUseCase', () => {
  const cnpj = buildCnpj();
  const ods13 = { id: faker.database.mongodbObjectId(), number: 13 };
  const ods15 = { id: faker.database.mongodbObjectId(), number: 15 };
  const evidences = {
    execute: vi.fn<ListCompanyEvidencesUseCase['execute']>(),
  };
  const repository = {
    findActiveOds: vi.fn<OdsScoreRepository['findActiveOds']>(),
    findProfileLocation: vi.fn<OdsScoreRepository['findProfileLocation']>(),
    replaceForCompany: vi.fn<OdsScoreRepository['replaceForCompany']>(),
  };
  let useCase: CalculateCompanyOdsScoresUseCase;

  beforeEach(async () => {
    vi.clearAllMocks();
    repository.findActiveOds.mockResolvedValue([ods13, ods15]);
    repository.findProfileLocation.mockResolvedValue(null);
    repository.replaceForCompany.mockResolvedValue(true);
    evidences.execute.mockResolvedValue([]);
    const moduleRef = await Test.createTestingModule({
      providers: [
        CalculateCompanyOdsScoresUseCase,
        { provide: ListCompanyEvidencesUseCase, useValue: evidences },
        { provide: OdsScoreRepository, useValue: repository },
      ],
    }).compile();
    useCase = moduleRef.get(CalculateCompanyOdsScoresUseCase);
  });

  it('recusa CNPJ inválido antes de acessar persistência', async () => {
    await expect(useCase.execute('invalido')).rejects.toThrow();
    expect(repository.findActiveOds).not.toHaveBeenCalled();
    expect(repository.replaceForCompany).not.toHaveBeenCalled();
  });

  it('falha sem ODS ativo ou sem regra antes de substituir os índices', async () => {
    repository.findActiveOds
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        ods13,
        { id: faker.database.mongodbObjectId(), number: 16 },
      ]);
    await expect(useCase.execute(cnpj)).rejects.toThrow('Nenhum ODS ativo');
    await expect(useCase.execute(cnpj)).rejects.toThrow('ODS 16 sem regras');
    expect(evidences.execute).not.toHaveBeenCalled();
    expect(repository.replaceForCompany).not.toHaveBeenCalled();
  });

  it('ambiente sem ODS ou sem regras lança ScoringNotConfiguredError (irrecuperável para a fila)', async () => {
    repository.findActiveOds.mockResolvedValueOnce([]);
    await expect(useCase.execute(cnpj)).rejects.toBeInstanceOf(
      ScoringNotConfiguredError,
    );

    repository.findActiveOds.mockResolvedValueOnce([
      { id: faker.database.mongodbObjectId(), number: 16 },
    ]);
    await expect(useCase.execute(cnpj)).rejects.toBeInstanceOf(
      ScoringNotConfiguredError,
    );
  });

  it('o instante do cálculo é o da leitura das evidências, e não o do fim (ordena recálculos concorrentes, #80)', async () => {
    vi.useFakeTimers();
    try {
      const readAt = new Date('2026-10-23T10:00:00.000Z');
      vi.setSystemTime(readAt);
      evidences.execute.mockImplementation(() => {
        // A leitura demora: o relógio anda enquanto ela acontece.
        vi.setSystemTime(new Date(readAt.getTime() + 5_000));

        return Promise.resolve([]);
      });

      const results = await useCase.execute(cnpj);

      expect(
        results.every(({ calculatedAt }) => +calculatedAt === +readAt),
      ).toBe(true);
      const [, saved] = repository.replaceForCompany.mock.calls[0];
      expect(saved.every(({ calculatedAt }) => +calculatedAt === +readAt)).toBe(
        true,
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('calcula ODS separados e persiste uma contribuição por evidência rastreável', async () => {
    const ghg = storedEvidenceFactory.build({
      category: EvidenceCategory.EMISSAO_GEE,
      sourceSlug: 'GHG_PROTOCOL',
      odsNumber: 13,
      signal: EvidenceSignal.POSITIVE,
      sourceReference: '5091/19',
      sourceUrl: null,
    });
    const ibama = storedEvidenceFactory.build({
      category: EvidenceCategory.INFRACAO_AMBIENTAL,
      odsNumber: 15,
      sourceReference: 'AI-1',
      sourceUrl: null,
    });
    const cgu = storedEvidenceFactory.build({
      category: EvidenceCategory.CONDUTA_ADMINISTRATIVA,
      sourceSlug: 'CGU_CEIS',
      odsNumber: 15,
      sourceReference: '370679',
      sourceUrl: null,
    });
    evidences.execute.mockResolvedValue([ghg, ibama, cgu]);
    repository.findProfileLocation.mockResolvedValue({
      uf: 'SP',
      city: 'São Paulo',
      cnaeCodes: ['6201501'],
    });

    const result = await useCase.execute(cnpj);

    expect(evidences.execute).toHaveBeenCalledWith(cnpj);
    expect(
      result.map((score) => [
        score.odsNumber,
        score.scoreValue,
        score.evidenceCount,
      ]),
    ).toEqual([
      [13, 60, 1],
      [15, -45, 2],
    ]);
    expect(
      result.every(
        (score) =>
          score.rulesVersion === 'rf10-rf11-v3' &&
          score.calculatedAt instanceof Date,
      ),
    ).toBe(true);
    expect(repository.replaceForCompany).toHaveBeenCalledWith(
      cnpj,
      result.map((score) => ({
        ...score,
        location: { uf: 'SP', city: 'São Paulo', cnaeCodes: ['6201501'] },
      })),
    );
  });

  it('UNKNOWN, ausência e evidência sem referência não criam índice', async () => {
    evidences.execute.mockResolvedValue([
      storedEvidenceFactory.build({
        odsNumber: 15,
        state: EvidenceState.UNKNOWN,
      }),
      storedEvidenceFactory.build({
        odsNumber: 15,
        state: EvidenceState.NOT_FOUND,
      }),
      storedEvidenceFactory.build({
        odsNumber: 15,
        sourceReference: null,
        sourceUrl: null,
      }),
    ]);
    const result = await useCase.execute(cnpj);
    expect(result).toEqual([
      expect.objectContaining({
        odsNumber: 13,
        scoreValue: null,
        confidenceValue: 0,
        evidenceCount: 0,
        contributions: [],
      }),
      expect.objectContaining({
        odsNumber: 15,
        scoreValue: null,
        confidenceValue: 0,
        evidenceCount: 0,
        contributions: [],
      }),
    ]);
  });

  it('falha de leitura não substitui pontuações anteriores', async () => {
    evidences.execute.mockRejectedValue(new Error('banco indisponível'));
    await expect(useCase.execute(cnpj)).rejects.toThrow('banco indisponível');
    expect(repository.replaceForCompany).not.toHaveBeenCalled();
  });
});

import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { EvidenceCategory, EvidenceSignal } from '@prisma/client';
import { CompanyNotFoundException } from '@modules/companies/domain/dtos/errors/company-not-found.exception.js';
import { InvalidCnpjException } from '@modules/companies/domain/dtos/errors/invalid-cnpj.exception.js';
import { CompanyProfileRepository } from '@modules/companies/domain/dtos/repositories/company-profile.repository.js';
import { ListCompanyEvidencesUseCase } from '@modules/evidences/infra/usecases/list-company-evidences.usecase.js';
import type { CompanyOdsScore } from '@modules/scoring/domain/dtos/requests/company-ods-scores.dto.js';
import { GetCompanyOdsScoresUseCase } from '@modules/scoring/infra/usecases/get-company-ods-scores.usecase.js';
import {
  buildCnpj,
  companyProfileResponseFactory,
  storedCompanyProfileFactory,
} from '@test/factories/companies/company-profile.factory.js';
import { storedEvidenceFactory } from '@test/factories/evidences/evidence.factory.js';
import { CompanyIndexEvolutionResponseSchema } from '../../domain/dtos/requests/company-index-evolution.dto.js';
import { GetCompanyIndexEvolutionUseCase } from './get-company-index-evolution.usecase.js';

const CALCULATED_AT = '2026-11-01T12:00:00.000Z';

function evidence(id: string, publishedAt: string) {
  return storedEvidenceFactory.build({
    id,
    key: id,
    category: EvidenceCategory.INFRACAO_AMBIENTAL,
    sourceSlug: 'IBAMA',
    sourceName: 'IBAMA',
    signal: EvidenceSignal.NEGATIVE,
    odsNumber: 15,
    sourceReference: id,
    sourceUrl: null,
    summary: `Auto ${id}`,
    publishedAt: new Date(publishedAt),
    details: null,
  });
}

function contribution(id: string): CompanyOdsScore['contributions'][number] {
  return {
    evidence: {
      id,
      category: EvidenceCategory.INFRACAO_AMBIENTAL,
      source_slug: 'IBAMA',
      source: 'IBAMA',
      state: 'CONFIRMED',
      current_state: 'CONFIRMED',
      source_reference: id,
      source_url: null,
      collected_at: CALCULATED_AT,
      valid_until: CALCULATED_AT,
    },
    weight: 40,
    weight_reason: null,
    signal: EvidenceSignal.NEGATIVE,
    points: -40,
  };
}

function score(overrides: Partial<CompanyOdsScore>): CompanyOdsScore {
  return {
    ods_number: 15,
    calculation_status: 'CALCULATED',
    index_status: 'AVAILABLE',
    score_value: null,
    confidence_value: 0.5,
    evidence_count: 0,
    coverage_status: 'HAS_RECORDS',
    sources_without_records: [],
    rules_version: 'rf10-rf11-v3',
    calculated_at: CALCULATED_AT,
    contributions: [],
    ...overrides,
  };
}

describe('GetCompanyIndexEvolutionUseCase', () => {
  const profiles = {
    findByCnpj: vi.fn<CompanyProfileRepository['findByCnpj']>(),
  };
  const scores = { execute: vi.fn<GetCompanyOdsScoresUseCase['execute']>() };
  const evidences = {
    execute: vi.fn<ListCompanyEvidencesUseCase['execute']>(),
  };
  const cnpj = buildCnpj();
  const [first, second] = [
    evidence('a'.repeat(24), '2022-06-01T00:00:00.000Z'),
    evidence('b'.repeat(24), '2024-03-10T00:00:00.000Z'),
  ];
  const twoYears = score({
    score_value: -80,
    evidence_count: 2,
    contributions: [contribution(first.id), contribution(second.id)],
  });
  let useCase: GetCompanyIndexEvolutionUseCase;

  const profileWith = (legalNatureCode: string | null) =>
    profiles.findByCnpj.mockResolvedValue(
      storedCompanyProfileFactory.build({
        profile: companyProfileResponseFactory.build({
          legal_nature_code: legalNatureCode,
        }),
      }),
    );

  beforeEach(async () => {
    profileWith('2062');
    scores.execute.mockResolvedValue([twoYears]);
    evidences.execute.mockResolvedValue([first, second]);

    const moduleRef = await Test.createTestingModule({
      providers: [
        GetCompanyIndexEvolutionUseCase,
        { provide: CompanyProfileRepository, useValue: profiles },
        { provide: GetCompanyOdsScoresUseCase, useValue: scores },
        { provide: ListCompanyEvidencesUseCase, useValue: evidences },
      ],
    }).compile();

    useCase = moduleRef.get(GetCompanyIndexEvolutionUseCase);
  });

  it('devolve os degraus, sem variação, com a evidência de cada um', async () => {
    const response = await useCase.execute(cnpj);

    expect(CompanyIndexEvolutionResponseSchema.parse(response)).toBeTruthy();
    expect(response.reconstructed).toBe(true);
    expect(response.ods[0]).toMatchObject({
      ods_number: 15,
      status: 'AVAILABLE',
    });
    expect(response.ods[0]?.steps.map((step) => step.score_value)).toEqual([
      -40, -80,
    ]);
    expect(response.ods[0]?.steps[1]?.evidence).toMatchObject({
      id: second.id,
      summary: second.summary,
    });
    expect(JSON.stringify(response)).not.toMatch(/delta|variation|previous/i);
  });

  it.each([
    ['2135', 'INDIVIDUAL_ENTREPRENEUR'],
    ['213-5', 'INDIVIDUAL_ENTREPRENEUR'],
    [null, 'LEGAL_NATURE_PENDING'],
  ])('natureza %s não tem série nem lê evidências', async (code, status) => {
    profileWith(code);

    const { ods } = await useCase.execute(cnpj);

    expect(ods).toEqual([{ ods_number: 15, status, steps: [] }]);
    expect(evidences.execute).not.toHaveBeenCalled();
  });

  it('ODS sem índice informa que não há evidência datada', async () => {
    scores.execute.mockResolvedValue([score({ ods_number: 13 })]);

    const { ods } = await useCase.execute(cnpj);

    expect(ods).toEqual([
      { ods_number: 13, status: 'NO_DATED_EVIDENCE', steps: [] },
    ]);
  });

  it('série que não reproduz o índice vai ao log e não é entregue', async () => {
    const error = vi
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    scores.execute.mockResolvedValue([{ ...twoYears, score_value: -40 }]);

    const { ods } = await useCase.execute(cnpj);

    expect(ods[0]).toMatchObject({ status: 'NOT_REPRODUCIBLE', steps: [] });
    expect(error).toHaveBeenCalledOnce();
  });

  it('empresa sem cadastro responde 404, e CNPJ inválido, 422', async () => {
    profiles.findByCnpj.mockResolvedValue(null);

    await expect(useCase.execute(cnpj)).rejects.toBeInstanceOf(
      CompanyNotFoundException,
    );
    await expect(useCase.execute('invalido')).rejects.toBeInstanceOf(
      InvalidCnpjException,
    );
  });
});

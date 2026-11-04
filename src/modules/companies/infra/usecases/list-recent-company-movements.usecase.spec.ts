import { Test } from '@nestjs/testing';
import type { CompanyMovementRow } from '@modules/scoring/domain/dtos/repositories/company-movement.repository.js';
import { ListCompanyMovementsUseCase } from '@modules/scoring/infra/usecases/list-company-movements.usecase.js';
import { ListOdsScoreSummariesUseCase } from '@modules/scoring/infra/usecases/list-ods-score-summaries.usecase.js';
import { CompanyProfileRepository } from '../../domain/dtos/repositories/company-profile.repository.js';
import { CompanyMovementsResponseSchema } from '../../domain/dtos/requests/company-movements.dto.js';
import { ListRecentCompanyMovementsUseCase } from './list-recent-company-movements.usecase.js';

describe('ListRecentCompanyMovementsUseCase', () => {
  const movedAt = new Date('2026-11-03T12:00:00.000Z');
  const movements = {
    execute: vi.fn<ListCompanyMovementsUseCase['execute']>(),
  };
  const profiles = {
    findIdentities: vi.fn<CompanyProfileRepository['findIdentities']>(),
  };
  const scores = { execute: vi.fn<ListOdsScoreSummariesUseCase['execute']>() };
  const identity = {
    cnpj: '1',
    legal_name: 'Empresa Um',
    trade_name: null,
    city: 'São Paulo',
    uf: 'SP',
  };
  const row: CompanyMovementRow = {
    cnpj: '1',
    movedAt,
    movements: [
      {
        odsNumber: 15,
        direction: 'DECREASED',
        cause: 'EVIDENCE_ADDED',
        evidenceCategory: 'INFRACAO_AMBIENTAL',
        movedAt,
      },
    ],
  };
  let useCase: ListRecentCompanyMovementsUseCase;

  beforeEach(async () => {
    vi.clearAllMocks();
    movements.execute.mockResolvedValue({ rows: [row], total: 41 });
    profiles.findIdentities.mockResolvedValue([identity]);
    scores.execute.mockResolvedValue({
      odsNumbers: [13, 15],
      summaries: [
        {
          cnpj: '1',
          odsNumber: 15,
          scoreValue: -40,
          confidenceValue: 0.33,
        },
      ],
    });

    const moduleRef = await Test.createTestingModule({
      providers: [
        ListRecentCompanyMovementsUseCase,
        { provide: ListCompanyMovementsUseCase, useValue: movements },
        { provide: CompanyProfileRepository, useValue: profiles },
        { provide: ListOdsScoreSummariesUseCase, useValue: scores },
      ],
    }).compile();

    useCase = moduleRef.get(ListRecentCompanyMovementsUseCase);
  });

  it('monta um item por empresa, com um registro por ODS ativo', async () => {
    const response = await useCase.execute({ page: 1, page_size: 20 });

    expect(response.data).toEqual([
      {
        ...identity,
        moved_at: '2026-11-03T12:00:00.000Z',
        ods: [
          {
            ods_number: 13,
            score_value: null,
            confidence_value: null,
            movement: null,
          },
          {
            ods_number: 15,
            score_value: -40,
            confidence_value: 0.33,
            movement: {
              direction: 'DECREASED',
              cause: 'EVIDENCE_ADDED',
              evidence_category: 'INFRACAO_AMBIENTAL',
              moved_at: '2026-11-03T12:00:00.000Z',
            },
          },
        ],
      },
    ]);
    expect(() => CompanyMovementsResponseSchema.parse(response)).not.toThrow();
  });

  it('traduz a página em janela de leitura e devolve a paginação', async () => {
    const { pagination } = await useCase.execute({ page: 3, page_size: 20 });

    expect(movements.execute).toHaveBeenCalledWith({ skip: 40, take: 20 });
    expect(pagination).toEqual({
      page: 3,
      page_size: 20,
      total: 41,
      total_pages: 3,
    });
  });

  it('lê identificação e índices só das empresas da página', async () => {
    await useCase.execute({ page: 1, page_size: 20 });

    expect(profiles.findIdentities).toHaveBeenCalledWith(['1']);
    expect(scores.execute).toHaveBeenCalledWith(['1']);
  });

  it('item sem perfil é ignorado, sem derrubar a tela', async () => {
    profiles.findIdentities.mockResolvedValue([]);

    await expect(
      useCase.execute({ page: 1, page_size: 20 }),
    ).resolves.toMatchObject({ data: [], pagination: { total: 41 } });
  });

  it('não expõe índice anterior nem variação (IND03)', async () => {
    const response = await useCase.execute({ page: 1, page_size: 20 });

    expect(JSON.stringify(response)).not.toMatch(/previous|delta|variation/);
  });
});

import type { ConfigService } from '@nestjs/config';
import type { Environment } from '@shared/config/environment.config.js';
import { faker } from '@test/support/faker.js';
import { OdsNotAvailableException } from '../../domain/dtos/errors/ods-not-available.errors.js';
import type { OdsScoreRepository } from '../../domain/dtos/repositories/ods-score.repository.js';
import type {
  SectorAggregate,
  SectorScoreSnapshotRepository,
} from '../../domain/dtos/repositories/sector-score-snapshot.repository.js';
import { ODS_SCORE_RULES_VERSION } from '../../domain/ods-score-rules.js';
import { AggregateSectorScoresUseCase } from './aggregate-sector-scores.usecase.js';
import { GetSectorEvolutionUseCase } from './get-sector-evolution.usecase.js';

describe('evolução setorial: casos de uso (#89, #90)', () => {
  const snapshots = {
    aggregateCurrentScores:
      vi.fn<SectorScoreSnapshotRepository['aggregateCurrentScores']>(),
    replaceWindow: vi.fn<SectorScoreSnapshotRepository['replaceWindow']>(),
    listEvolution: vi.fn<SectorScoreSnapshotRepository['listEvolution']>(),
  };
  const odsId = faker.database.mongodbObjectId();

  describe('AggregateSectorScoresUseCase', () => {
    const config = {
      get: () => 3,
    } as unknown as ConfigService<Environment, true>;
    const useCase = new AggregateSectorScoresUseCase(snapshots, config);
    const aggregate = (
      overrides: Partial<SectorAggregate> = {},
    ): SectorAggregate => ({
      odsId,
      cnaeDivision: '62',
      companyCount: 5,
      scoredCompanyCount: 4,
      averageScore: -8,
      averageConfidence: 0.55,
      ...overrides,
    });

    it('agrega os índices da versão de regras vigente e grava na janela do mês', async () => {
      const big = aggregate();
      snapshots.aggregateCurrentScores.mockResolvedValue([big]);

      const result = await useCase.execute(new Date('2026-10-28T15:00:00Z'));

      expect(snapshots.aggregateCurrentScores).toHaveBeenCalledWith(
        ODS_SCORE_RULES_VERSION,
      );
      expect(snapshots.replaceWindow).toHaveBeenCalledWith(
        {
          start: new Date('2026-10-01T00:00:00Z'),
          end: new Date('2026-11-01T00:00:00Z'),
        },
        [big],
        ODS_SCORE_RULES_VERSION,
      );
      expect(result).toEqual({
        windowStart: '2026-10-01T00:00:00.000Z',
        sectors: 1,
      });
    });

    it('aplica a amostra mínima (SECTOR_SNAPSHOT_MIN_COMPANIES) antes de gravar', async () => {
      snapshots.aggregateCurrentScores.mockResolvedValue([
        aggregate({
          cnaeDivision: '01',
          companyCount: 2,
          scoredCompanyCount: 2,
        }),
        aggregate({
          cnaeDivision: '62',
          companyCount: 4,
          scoredCompanyCount: 2,
        }),
      ]);

      await useCase.execute(new Date('2026-10-28T15:00:00Z'));

      const [, saved] = snapshots.replaceWindow.mock.calls[0];
      expect(saved).toEqual([
        expect.objectContaining({
          cnaeDivision: '01',
          averageScore: null,
          averageConfidence: null,
          companyCount: 2,
        }),
        expect.objectContaining({
          cnaeDivision: '62',
          averageScore: null,
          averageConfidence: 0.55,
        }),
      ]);
    });

    it('nada gravado por empresa: os agregados só têm setor, médias e contagens', async () => {
      snapshots.aggregateCurrentScores.mockResolvedValue([aggregate()]);

      await useCase.execute(new Date());

      const [, saved] = snapshots.replaceWindow.mock.calls[0];
      for (const item of saved) {
        expect(Object.keys(item).sort()).toEqual(
          [
            'averageConfidence',
            'averageScore',
            'cnaeDivision',
            'companyCount',
            'odsId',
            'scoredCompanyCount',
          ].sort(),
        );
      }
    });
  });

  describe('GetSectorEvolutionUseCase', () => {
    const scores = {
      findActiveOds: vi.fn<OdsScoreRepository['findActiveOds']>(),
    };
    const useCase = new GetSectorEvolutionUseCase(
      scores as unknown as OdsScoreRepository,
      snapshots,
    );
    const window = (month: number) => ({
      windowStart: new Date(Date.UTC(2026, month, 1)),
      windowEnd: new Date(Date.UTC(2026, month + 1, 1)),
      averageScore: -5,
      averageConfidence: 0.5,
      companyCount: 8,
      scoredCompanyCount: 6,
      rulesVersion: ODS_SCORE_RULES_VERSION,
    });

    beforeEach(() => {
      scores.findActiveOds.mockResolvedValue([
        { id: faker.database.mongodbObjectId(), number: 13 },
        { id: odsId, number: 15 },
      ]);
    });

    it('lê as janelas do ODS e do setor e as devolve no formato da API', async () => {
      snapshots.listEvolution.mockResolvedValue([window(8), window(9)]);

      const evolution = await useCase.execute({
        cnaeDivision: '62',
        odsNumber: 15,
      });

      expect(snapshots.listEvolution).toHaveBeenCalledWith(odsId, '62');
      expect(evolution).toEqual({
        cnae_division: '62',
        ods_number: 15,
        history_status: 'AVAILABLE',
        windows: [
          expect.objectContaining({
            window_start: '2026-09-01T00:00:00.000Z',
            window_end: '2026-10-01T00:00:00.000Z',
            average_score: -5,
            company_count: 8,
          }),
          expect.objectContaining({ window_start: '2026-10-01T00:00:00.000Z' }),
        ],
      });
    });

    it.each([
      [0, []],
      [1, [window(9)]],
    ])(
      'com %i janela(s), o histórico é insuficiente (fluxo 2.1)',
      async (_, windows) => {
        snapshots.listEvolution.mockResolvedValue(windows);

        await expect(
          useCase.execute({ cnaeDivision: '62', odsNumber: 15 }),
        ).resolves.toMatchObject({ history_status: 'INSUFFICIENT' });
      },
    );

    it('ODS que o BIOS não calcula: 422 com os válidos, sem consultar os agregados', async () => {
      const error = await useCase
        .execute({ cnaeDivision: '62', odsNumber: 7 })
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(OdsNotAvailableException);
      expect(error).toMatchObject({ details: { ods: 7, valid_ods: [13, 15] } });
      expect(snapshots.listEvolution).not.toHaveBeenCalled();
    });
  });
});

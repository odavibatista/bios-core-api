import type { PrismaService } from '@shared/infra/database/prisma.service.js';
import { faker } from '@test/support/faker.js';
import { PrismaSectorScoreSnapshotRepository } from './prisma-sector-score-snapshot.repository.js';

describe('PrismaSectorScoreSnapshotRepository (#89, #90)', () => {
  const aggregateRaw = vi.fn();
  const upsert = vi.fn();
  const findMany = vi.fn();
  const deleteMany = vi.fn();
  const repository = new PrismaSectorScoreSnapshotRepository({
    companyOdsScore: { aggregateRaw },
    sectorScoreSnapshot: { upsert, findMany, deleteMany },
  } as unknown as PrismaService);
  const odsId = faker.database.mongodbObjectId();
  const window = {
    start: new Date('2026-10-01T00:00:00Z'),
    end: new Date('2026-11-01T00:00:00Z'),
  };

  describe('aggregateCurrentScores', () => {
    it('filtra a versão de regras, lê o setor do perfil e agrupa por ODS e divisão', async () => {
      aggregateRaw.mockResolvedValue([]);

      await repository.aggregateCurrentScores('v9');

      const [{ pipeline }] = aggregateRaw.mock.calls[0] as [
        { pipeline: Record<string, unknown>[] },
      ];
      expect(pipeline[0]).toEqual({ $match: { rules_version: 'v9' } });
      expect(pipeline[1]).toMatchObject({
        $lookup: { from: 'company_profile', localField: 'cnpj' },
      });
      expect(pipeline[3]).toMatchObject({
        $group: {
          _id: {
            ods_id: '$ods_id',
            division: { $substrBytes: ['$profile.code', 0, 2] },
          },
        },
      });
    });

    it('converte as linhas do MongoDB nos totais do setor', async () => {
      aggregateRaw.mockResolvedValue([
        {
          _id: { ods_id: { $oid: odsId }, division: '62' },
          company_count: 6,
          scored_company_count: 5,
          average_score: -2,
          average_confidence: 0.5,
        },
        {
          _id: { ods_id: { $oid: odsId }, division: '01' },
          company_count: 1,
          scored_company_count: 0,
          average_score: null,
          average_confidence: 0.3,
        },
      ]);

      await expect(repository.aggregateCurrentScores('v9')).resolves.toEqual([
        {
          odsId,
          cnaeDivision: '62',
          companyCount: 6,
          scoredCompanyCount: 5,
          averageScore: -2,
          averageConfidence: 0.5,
        },
        {
          odsId,
          cnaeDivision: '01',
          companyCount: 1,
          scoredCompanyCount: 0,
          averageScore: null,
          averageConfidence: 0.3,
        },
      ]);
    });

    it('recusa linha fora do formato esperado', async () => {
      aggregateRaw.mockResolvedValue([{ _id: 'x' }]);

      await expect(repository.aggregateCurrentScores('v9')).rejects.toThrow();
    });
  });

  describe('replaceWindow', () => {
    const aggregate = {
      odsId,
      cnaeDivision: '62',
      companyCount: 6,
      scoredCompanyCount: 5,
      averageScore: -2,
      averageConfidence: 0.5,
    };

    it('grava cada agregado pela chave única (ODS, setor, início da janela)', async () => {
      findMany.mockResolvedValue([]);

      await repository.replaceWindow(window, [aggregate], 'v9');

      const values = {
        window_end: window.end,
        average_score: -2,
        average_confidence: 0.5,
        company_count: 6,
        scored_company_count: 5,
        rules_version: 'v9',
      };
      expect(upsert).toHaveBeenCalledWith({
        where: {
          ods_id_cnae_division_window_start: {
            ods_id: odsId,
            cnae_division: '62',
            window_start: window.start,
          },
        },
        create: {
          ods_id: odsId,
          cnae_division: '62',
          window_start: window.start,
          ...values,
        },
        update: values,
      });
      expect(deleteMany).not.toHaveBeenCalled();
    });

    it('remove da janela os setores que não vieram, e só eles', async () => {
      const gone = faker.database.mongodbObjectId();
      findMany.mockResolvedValue([
        {
          id_sector_score_snapshot: faker.database.mongodbObjectId(),
          ods_id: odsId,
          cnae_division: '62',
        },
        { id_sector_score_snapshot: gone, ods_id: odsId, cnae_division: '47' },
      ]);

      await repository.replaceWindow(window, [aggregate], 'v9');

      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { window_start: window.start } }),
      );
      expect(deleteMany).toHaveBeenCalledWith({
        where: { id_sector_score_snapshot: { in: [gone] } },
      });
    });
  });

  it('listEvolution lê o ODS e o setor em ordem de janela e converte os campos', async () => {
    findMany.mockResolvedValue([
      {
        window_start: window.start,
        window_end: window.end,
        average_score: null,
        average_confidence: null,
        company_count: 2,
        scored_company_count: 1,
        rules_version: 'v9',
      },
    ]);

    await expect(repository.listEvolution(odsId, '62')).resolves.toEqual([
      {
        windowStart: window.start,
        windowEnd: window.end,
        averageScore: null,
        averageConfidence: null,
        companyCount: 2,
        scoredCompanyCount: 1,
        rulesVersion: 'v9',
      },
    ]);
    expect(findMany).toHaveBeenCalledWith({
      where: { ods_id: odsId, cnae_division: '62' },
      orderBy: { window_start: 'asc' },
    });
  });
});

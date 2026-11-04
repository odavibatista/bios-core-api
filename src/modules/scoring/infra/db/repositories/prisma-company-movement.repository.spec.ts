import type { PrismaService } from '@shared/infra/database/prisma.service.js';
import { PrismaCompanyMovementRepository } from './prisma-company-movement.repository.js';

describe('PrismaCompanyMovementRepository', () => {
  const prisma = {
    companyProfile: { findMany: vi.fn() },
    companyMovement: { findMany: vi.fn(), create: vi.fn(), count: vi.fn() },
    companyOdsScore: { findMany: vi.fn() },
    evidenceNormalized: { findMany: vi.fn() },
  };
  const repository = new PrismaCompanyMovementRepository(
    prisma as unknown as PrismaService,
  );
  const published = new Date('2026-10-01T00:00:00.000Z');
  const collected = new Date('2026-11-01T00:00:00.000Z');

  beforeEach(() => {
    vi.clearAllMocks();
    prisma.companyMovement.findMany.mockResolvedValue([]);
    prisma.companyOdsScore.findMany.mockResolvedValue([]);
    prisma.evidenceNormalized.findMany.mockResolvedValue([]);
  });

  describe('findPage', () => {
    it('lê a janela na ordem do índice e traduz para o domínio', async () => {
      prisma.companyMovement.findMany.mockResolvedValue([
        {
          cnpj: '1',
          moved_at: collected,
          ods_movements: [
            {
              ods_number: 15,
              direction: 'DECREASED',
              cause: 'EVIDENCE_ADDED',
              evidence_category: 'INFRACAO_AMBIENTAL',
              moved_at: published,
            },
          ],
        },
      ]);
      prisma.companyMovement.count.mockResolvedValue(7);

      await expect(
        repository.findPage({ skip: 20, take: 10 }),
      ).resolves.toEqual({
        rows: [
          {
            cnpj: '1',
            movedAt: collected,
            movements: [
              {
                odsNumber: 15,
                direction: 'DECREASED',
                cause: 'EVIDENCE_ADDED',
                evidenceCategory: 'INFRACAO_AMBIENTAL',
                movedAt: published,
              },
            ],
          },
        ],
        total: 7,
      });
      expect(prisma.companyMovement.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ moved_at: 'desc' }, { cnpj: 'asc' }],
          skip: 20,
          take: 10,
        }),
      );
    });
  });

  describe('findCandidates', () => {
    it('sem perfis depois do cursor, a varredura acabou', async () => {
      prisma.companyProfile.findMany.mockResolvedValue([]);

      await expect(repository.findCandidates('9', 10)).resolves.toEqual({
        candidates: [],
        nextCursor: null,
      });
      expect(prisma.companyProfile.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { cnpj: { gt: '9' } },
          orderBy: { cnpj: 'asc' },
          take: 10,
        }),
      );
    });

    it('sem cursor, começa do primeiro CNPJ', async () => {
      prisma.companyProfile.findMany.mockResolvedValue([]);

      await repository.findCandidates(null, 10);

      expect(prisma.companyProfile.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: {} }),
      );
    });

    it('com tudo já movimentado, não lê índices e segue o cursor', async () => {
      prisma.companyProfile.findMany.mockResolvedValue([{ cnpj: '1' }]);
      prisma.companyMovement.findMany.mockResolvedValue([{ cnpj: '1' }]);

      await expect(repository.findCandidates(null, 10)).resolves.toEqual({
        candidates: [],
        nextCursor: '1',
      });
      expect(prisma.companyOdsScore.findMany).not.toHaveBeenCalled();
    });

    it('data a evidência pelo fato, nunca pela coleta', async () => {
      prisma.companyProfile.findMany.mockResolvedValue([
        { cnpj: '1' },
        { cnpj: '2' },
      ]);
      prisma.companyOdsScore.findMany.mockResolvedValue([
        {
          cnpj: '1',
          ods_id: 'ods-15',
          ods_number: 15,
          score_value: -45,
          contributions: [
            { evidence_id: 'a', category: 'INFRACAO_AMBIENTAL', points: -40 },
            {
              evidence_id: 'b',
              category: 'CONDUTA_ADMINISTRATIVA',
              points: -5,
            },
            { evidence_id: 'c', category: 'CONDUTA_ADMINISTRATIVA', points: 0 },
          ],
        },
        {
          cnpj: '2',
          ods_id: 'ods-13',
          ods_number: 13,
          contributions: [],
        },
      ]);
      prisma.evidenceNormalized.findMany.mockResolvedValue([
        { id_evidence: 'a', published_at: published, details: null },
        {
          id_evidence: 'b',
          published_at: null,
          details: { startDate: '2026-11-01' },
        },
        { id_evidence: 'c', published_at: null, details: null },
      ]);

      await expect(repository.findCandidates(null, 10)).resolves.toEqual({
        candidates: [
          {
            cnpj: '1',
            scores: [
              {
                odsId: 'ods-15',
                odsNumber: 15,
                contributions: [
                  {
                    evidenceId: 'a',
                    category: 'INFRACAO_AMBIENTAL',
                    points: -40,
                    evidenceDate: published,
                  },
                  {
                    evidenceId: 'b',
                    category: 'CONDUTA_ADMINISTRATIVA',
                    points: -5,
                    evidenceDate: new Date('2026-11-01'),
                  },
                  {
                    evidenceId: 'c',
                    category: 'CONDUTA_ADMINISTRATIVA',
                    points: 0,
                    evidenceDate: null,
                  },
                ],
              },
            ],
          },
        ],
        nextCursor: '2',
      });
    });

    it('lê as evidências em blocos', async () => {
      prisma.companyProfile.findMany.mockResolvedValue([{ cnpj: '1' }]);
      prisma.companyOdsScore.findMany.mockResolvedValue([
        {
          cnpj: '1',
          ods_id: 'ods-15',
          ods_number: 15,
          score_value: -80,
          contributions: Array.from({ length: 150 }, (_, index) => ({
            evidence_id: String(index),
            category: 'INFRACAO_AMBIENTAL',
            points: -1,
          })),
        },
      ]);

      await repository.findCandidates(null, 10);

      expect(prisma.evidenceNormalized.findMany).toHaveBeenCalledTimes(2);
    });
  });

  describe('createIfMissing', () => {
    const movement = {
      odsId: 'ods-15',
      odsNumber: 15,
      direction: 'DECREASED',
      cause: 'EVIDENCE_ADDED',
      evidenceCategory: 'INFRACAO_AMBIENTAL',
      movedAt: published,
    } as const;

    it('grava com moved_at da movimentação mais recente', async () => {
      await expect(
        repository.createIfMissing('1', [
          movement,
          { ...movement, odsId: 'ods-13', odsNumber: 13, movedAt: collected },
        ]),
      ).resolves.toBe(true);

      expect(prisma.companyMovement.create).toHaveBeenCalledWith({
        data: {
          cnpj: '1',
          moved_at: collected,
          ods_movements: [
            expect.objectContaining({ ods_number: 15, moved_at: published }),
            expect.objectContaining({ ods_number: 13, moved_at: collected }),
          ],
        },
      });
    });

    it('chave repetida quer dizer que um recálculo chegou antes', async () => {
      prisma.companyMovement.create.mockRejectedValueOnce({ code: 'P2002' });

      await expect(repository.createIfMissing('1', [movement])).resolves.toBe(
        false,
      );
    });

    it('outro erro sobe', async () => {
      const failure = new Error('banco fora do ar');

      prisma.companyMovement.create.mockRejectedValueOnce(failure);

      await expect(repository.createIfMissing('1', [movement])).rejects.toBe(
        failure,
      );
    });
  });
});

import type { PrismaService } from '@shared/infra/database/prisma.service.js';
import { faker } from '@test/support/faker.js';
import type { OdsScoreToSave } from '../../../domain/dtos/repositories/ods-score.repository.js';
import { PrismaOdsScoreRepository } from './prisma-ods-score.repository.js';

describe('PrismaOdsScoreRepository', () => {
  type TransactionClient = {
    companyOdsScore: {
      upsert: ReturnType<typeof vi.fn>;
      deleteMany: ReturnType<typeof vi.fn>;
    };
  };
  const tx: TransactionClient = {
    companyOdsScore: { upsert: vi.fn(), deleteMany: vi.fn() },
  };
  const prisma = {
    ods: { findMany: vi.fn() },
    companyProfile: { findUnique: vi.fn() },
    $transaction: vi.fn(
      async (run: (client: TransactionClient) => Promise<void>) => run(tx),
    ),
  };
  const repo = new PrismaOdsScoreRepository(prisma as unknown as PrismaService);

  beforeEach(() => vi.clearAllMocks());

  it('carrega somente ODS ativos em ordem e preserva os IDs reais', async () => {
    const id = faker.database.mongodbObjectId();
    prisma.ods.findMany.mockResolvedValue([{ id_ods: id, ods_number: 13 }]);
    await expect(repo.findActiveOds()).resolves.toEqual([{ id, number: 13 }]);
    expect(prisma.ods.findMany).toHaveBeenCalledWith({
      where: { is_active: true },
      select: { id_ods: true, ods_number: true },
      orderBy: { ods_number: 'asc' },
    });
  });

  it('sem perfil não inventa localização ou CNAE', async () => {
    prisma.companyProfile.findUnique.mockResolvedValue(null);
    await expect(
      repo.findProfileLocation('11222333000181'),
    ).resolves.toBeNull();
  });

  it('lê UF, cidade e CNAEs sem duplicar códigos', async () => {
    prisma.companyProfile.findUnique.mockResolvedValue({
      address: { uf: 'SP', city: 'São Paulo' },
      main_cnae: { code: '6201501' },
      secondary_cnaes: [{ code: '6201501' }, { code: '6311900' }],
    });
    await expect(repo.findProfileLocation('11222333000181')).resolves.toEqual({
      uf: 'SP',
      city: 'São Paulo',
      cnaeCodes: ['6201501', '6311900'],
    });
    expect(prisma.companyProfile.findUnique).toHaveBeenCalledWith({
      where: { cnpj: '11222333000181' },
      select: { address: true, main_cnae: true, secondary_cnaes: true },
    });
  });

  it('substitui scores por chave única na transação e remove ODS inativos', async () => {
    const score: OdsScoreToSave = {
      cnpj: '11222333000181',
      odsId: faker.database.mongodbObjectId(),
      odsNumber: 15,
      scoreValue: -40,
      confidenceValue: 0.4,
      evidenceCount: 1,
      contributions: [
        {
          evidenceId: faker.database.mongodbObjectId(),
          category: 'INFRACAO_AMBIENTAL',
          signal: 'NEGATIVE',
          weight: 40,
          points: -40,
        },
      ],
      rulesVersion: 'rf10-v1',
      calculatedAt: new Date(),
      location: { uf: 'SP', city: 'São Paulo', cnaeCodes: ['6201501'] },
    };
    await repo.replaceForCompany(score.cnpj, [score]);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    const fields = {
      ods_number: 15,
      score_value: -40,
      confidence_value: 0.4,
      evidence_count: 1,
      contributions: [
        {
          evidence_id: score.contributions[0].evidenceId,
          category: 'INFRACAO_AMBIENTAL',
          signal: 'NEGATIVE',
          weight: 40,
          points: -40,
        },
      ],
      rules_version: 'rf10-v1',
      uf: 'SP',
      city: 'São Paulo',
      cnae_codes: ['6201501'],
      calculated_at: score.calculatedAt,
    };
    expect(tx.companyOdsScore.upsert).toHaveBeenCalledWith({
      where: { cnpj_ods_id: { cnpj: score.cnpj, ods_id: score.odsId } },
      create: { cnpj: score.cnpj, ods_id: score.odsId, ...fields },
      update: fields,
    });
    expect(tx.companyOdsScore.deleteMany).toHaveBeenCalledWith({
      where: { cnpj: score.cnpj, ods_id: { notIn: [score.odsId] } },
    });
  });

  it('sem perfil grava localização nula e CNAEs vazios', async () => {
    await repo.replaceForCompany('11222333000181', [
      {
        cnpj: '11222333000181',
        odsId: faker.database.mongodbObjectId(),
        odsNumber: 13,
        scoreValue: null,
        confidenceValue: 0,
        evidenceCount: 0,
        contributions: [],
        rulesVersion: 'rf10-v1',
        calculatedAt: new Date(),
        location: null,
      },
    ]);
    expect(tx.companyOdsScore.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          uf: null,
          city: null,
          cnae_codes: [],
        }),
      }),
    );
  });
});

import type { PrismaService } from '@shared/infra/database/prisma.service.js';
import { faker } from '@test/support/faker.js';
import type { OdsScoreToSave } from '../../../domain/dtos/repositories/ods-score.repository.js';
import { PrismaOdsScoreRepository } from './prisma-ods-score.repository.js';

describe('PrismaOdsScoreRepository', () => {
  type TransactionClient = {
    companyOdsScore: {
      upsert: ReturnType<typeof vi.fn>;
      deleteMany: ReturnType<typeof vi.fn>;
      findFirst: ReturnType<typeof vi.fn>;
    };
  };
  const tx: TransactionClient = {
    companyOdsScore: {
      upsert: vi.fn(),
      deleteMany: vi.fn(),
      findFirst: vi.fn(),
    },
  };
  const prisma = {
    ods: { findMany: vi.fn() },
    companyOdsScore: { findFirst: vi.fn(), findMany: vi.fn() },
    companyProfile: { findUnique: vi.fn() },
    $transaction: vi.fn(
      async (run: (client: TransactionClient) => Promise<void>) => run(tx),
    ),
  };
  const repo = new PrismaOdsScoreRepository(prisma as unknown as PrismaService);

  beforeEach(() => {
    vi.clearAllMocks();
    // Sem índice mais novo gravado: a guarda deixa passar.
    tx.companyOdsScore.findFirst.mockResolvedValue(null);
  });

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

  it('o catálogo traz título e descrição só dos ODS ativos, em ordem de número', async () => {
    const id = faker.database.mongodbObjectId();
    prisma.ods.findMany.mockResolvedValue([
      { id_ods: id, ods_number: 13, title: 'Clima', description: 'Descrição' },
    ]);

    await expect(repo.findOdsCatalog()).resolves.toEqual([
      { id, number: 13, title: 'Clima', description: 'Descrição' },
    ]);
    expect(prisma.ods.findMany).toHaveBeenCalledWith({
      where: { is_active: true },
      select: {
        id_ods: true,
        ods_number: true,
        title: true,
        description: true,
      },
      orderBy: { ods_number: 'asc' },
    });
  });

  describe('findSummariesByCnpjs', () => {
    it('lê só índice e confiança das empresas dadas, em todos os ODS', async () => {
      prisma.companyOdsScore.findMany.mockResolvedValue([
        {
          cnpj: '11222333000181',
          ods_number: 15,
          score_value: -5,
          confidence_value: 0.2,
        },
        {
          cnpj: '11222333000181',
          ods_number: 13,
          score_value: null,
          confidence_value: 0,
        },
      ]);

      await expect(
        repo.findSummariesByCnpjs(['11222333000181', '00000000000191']),
      ).resolves.toEqual([
        {
          cnpj: '11222333000181',
          odsNumber: 15,
          scoreValue: -5,
          confidenceValue: 0.2,
        },
        {
          cnpj: '11222333000181',
          odsNumber: 13,
          scoreValue: null,
          confidenceValue: 0,
        },
      ]);
      expect(prisma.companyOdsScore.findMany).toHaveBeenCalledWith({
        where: { cnpj: { in: ['11222333000181', '00000000000191'] } },
        select: {
          cnpj: true,
          ods_number: true,
          score_value: true,
          confidence_value: true,
        },
      });
    });

    it('sem empresas, nem consulta o banco', async () => {
      await expect(repo.findSummariesByCnpjs([])).resolves.toEqual([]);
      expect(prisma.companyOdsScore.findMany).not.toHaveBeenCalled();
    });

    it('nota ausente no documento vale como nula', async () => {
      prisma.companyOdsScore.findMany.mockResolvedValue([
        { cnpj: '11222333000181', ods_number: 13, confidence_value: 0 },
      ]);

      const [summary] = await repo.findSummariesByCnpjs(['11222333000181']);

      expect(summary.scoreValue).toBeNull();
    });
  });

  it('lê o retrato do índice e mapeia as contribuições sem recálculo', async () => {
    const id = faker.database.mongodbObjectId();
    const calculatedAt = new Date();
    prisma.companyOdsScore.findFirst.mockResolvedValue({
      cnpj: '11222333000181',
      ods_number: 15,
      score_value: -5,
      confidence_value: 0.2,
      evidence_count: 1,
      contributions: [
        {
          evidence_id: id,
          category: 'CONDUTA_ADMINISTRATIVA',
          signal: 'NEGATIVE',
          weight: 5,
          points: -5,
        },
      ],
      rules_version: 'rf10-rf11-v3',
      calculated_at: calculatedAt,
    });
    await expect(
      repo.findByCnpjAndOdsNumber('11222333000181', 15),
    ).resolves.toEqual({
      cnpj: '11222333000181',
      odsNumber: 15,
      scoreValue: -5,
      confidenceValue: 0.2,
      evidenceCount: 1,
      contributions: [
        {
          evidenceId: id,
          category: 'CONDUTA_ADMINISTRATIVA',
          signal: 'NEGATIVE',
          weight: 5,
          points: -5,
        },
      ],
      rulesVersion: 'rf10-rf11-v3',
      calculatedAt,
    });
    expect(prisma.companyOdsScore.findFirst).toHaveBeenCalledWith({
      where: { cnpj: '11222333000181', ods_number: 15 },
    });
    prisma.companyOdsScore.findFirst.mockResolvedValue(null);
    await expect(
      repo.findByCnpjAndOdsNumber('11222333000181', 13),
    ).resolves.toBeNull();
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
          weightReason: null,
          points: -40,
        },
      ],
      coverageStatus: 'HAS_RECORDS',
      sourcesWithoutRecords: ['CGU_CEIS'],
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
          weight_reason: null,
          points: -40,
        },
      ],
      coverage_status: 'HAS_RECORDS',
      sources_without_records: ['CGU_CEIS'],
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

  describe('guarda: um recálculo nunca regride um índice mais novo (#80)', () => {
    const base = {
      cnpj: '11222333000181',
      odsNumber: 13,
      scoreValue: null,
      confidenceValue: 0,
      evidenceCount: 0,
      contributions: [],
      coverageStatus: 'NO_DATA' as const,
      sourcesWithoutRecords: [],
      rulesVersion: 'rf10-v1',
      location: null,
    };
    const readAt = new Date('2026-10-23T10:00:00.000Z');

    it('sem índice mais novo, grava e devolve true', async () => {
      await expect(
        repo.replaceForCompany(base.cnpj, [
          {
            ...base,
            odsId: faker.database.mongodbObjectId(),
            calculatedAt: readAt,
          },
        ]),
      ).resolves.toBe(true);

      expect(tx.companyOdsScore.findFirst).toHaveBeenCalledWith({
        where: { cnpj: base.cnpj, calculated_at: { gt: readAt } },
        select: { id_company_ods_score: true },
      });
      expect(tx.companyOdsScore.upsert).toHaveBeenCalledOnce();
    });

    it('com índice calculado depois desta leitura, não grava nada e devolve false', async () => {
      tx.companyOdsScore.findFirst.mockResolvedValue({
        id_company_ods_score: faker.database.mongodbObjectId(),
      });

      await expect(
        repo.replaceForCompany(base.cnpj, [
          {
            ...base,
            odsId: faker.database.mongodbObjectId(),
            calculatedAt: readAt,
          },
        ]),
      ).resolves.toBe(false);

      expect(tx.companyOdsScore.upsert).not.toHaveBeenCalled();
      expect(tx.companyOdsScore.deleteMany).not.toHaveBeenCalled();
    });

    it('compara com o instante de leitura mais recente entre os índices da execução', async () => {
      const later = new Date(readAt.getTime() + 5);

      await repo.replaceForCompany(base.cnpj, [
        {
          ...base,
          odsId: faker.database.mongodbObjectId(),
          calculatedAt: readAt,
        },
        {
          ...base,
          odsNumber: 15,
          odsId: faker.database.mongodbObjectId(),
          calculatedAt: later,
        },
      ]);

      expect(tx.companyOdsScore.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { cnpj: base.cnpj, calculated_at: { gt: later } },
        }),
      );
    });
  });

  describe('empresas com índice de outra versão das regras (#80)', () => {
    it('lê em ordem de CNPJ, a partir do cursor, só das outras versões, e devolve empresas distintas', async () => {
      prisma.companyOdsScore.findMany.mockResolvedValue([
        { cnpj: '00000000000191' },
        { cnpj: '00000000000191' },
        { cnpj: '11222333000181' },
        { cnpj: '11222333000181' },
        { cnpj: '33000167000101' },
      ]);

      await expect(
        repo.findCnpjsWithOtherRulesVersion('rf10-v9', '00000000000100', 2),
      ).resolves.toEqual(['00000000000191', '11222333000181']);

      expect(prisma.companyOdsScore.findMany).toHaveBeenCalledWith({
        where: {
          rules_version: { not: 'rf10-v9' },
          cnpj: { gt: '00000000000100' },
        },
        select: { cnpj: true },
        orderBy: { cnpj: 'asc' },
        take: 8,
      });
    });

    it('sem cursor, lê desde o começo', async () => {
      prisma.companyOdsScore.findMany.mockResolvedValue([]);

      await expect(
        repo.findCnpjsWithOtherRulesVersion('rf10-v9', null, 10),
      ).resolves.toEqual([]);

      expect(prisma.companyOdsScore.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { rules_version: { not: 'rf10-v9' } },
        }),
      );
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
        coverageStatus: 'NO_DATA',
        sourcesWithoutRecords: [],
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

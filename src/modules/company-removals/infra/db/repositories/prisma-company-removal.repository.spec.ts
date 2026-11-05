import type { PrismaService } from '@shared/infra/database/prisma.service.js';
import { buildCnpj } from '@test/factories/companies/company-profile.factory.js';
import { PrismaCompanyRemovalRepository } from './prisma-company-removal.repository.js';

describe('PrismaCompanyRemovalRepository', () => {
  const removedAt = new Date('2026-11-05T12:00:00.000Z');
  const deleteMany = () => vi.fn().mockResolvedValue({ count: 1 });
  const prisma = {
    companyRemoval: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      upsert: vi.fn(),
      deleteMany: vi.fn(),
      count: vi.fn(),
    },
    companyProfile: { deleteMany: deleteMany() },
    companyOdsScore: { deleteMany: deleteMany() },
    companyMovement: { deleteMany: deleteMany() },
    evidenceNormalized: { deleteMany: deleteMany() },
    evidenceRaw: { deleteMany: deleteMany() },
  };
  const repository = new PrismaCompanyRemovalRepository(
    prisma as unknown as PrismaService,
  );
  const cnpj = buildCnpj();

  it('consulta a lista', async () => {
    prisma.companyRemoval.findUnique.mockResolvedValueOnce({ cnpj });
    prisma.companyRemoval.findUnique.mockResolvedValueOnce(null);

    await expect(repository.isRemoved(cnpj)).resolves.toBe(true);
    await expect(repository.isRemoved(cnpj)).resolves.toBe(false);
  });

  it('devolve todos os CNPJs da lista', async () => {
    prisma.companyRemoval.findMany.mockResolvedValue([{ cnpj }]);

    await expect(repository.findAllCnpjs()).resolves.toEqual(new Set([cnpj]));
  });

  it('registra a retirada antes de apagar os dados da empresa', async () => {
    const order: string[] = [];
    prisma.companyRemoval.upsert.mockImplementation(() => {
      order.push('lista');

      return Promise.resolve({ cnpj, removed_at: removedAt });
    });
    prisma.companyProfile.deleteMany.mockImplementation(() => {
      order.push('dados');

      return Promise.resolve({ count: 1 });
    });

    await expect(repository.remove(cnpj)).resolves.toEqual({ cnpj, removedAt });

    expect(order).toEqual(['lista', 'dados']);
    for (const collection of [
      prisma.companyProfile,
      prisma.companyOdsScore,
      prisma.companyMovement,
      prisma.evidenceNormalized,
      prisma.evidenceRaw,
    ]) {
      expect(collection.deleteMany).toHaveBeenCalledWith({ where: { cnpj } });
    }
  });

  it('informa se o CNPJ estava na lista ao devolvê-lo', async () => {
    prisma.companyRemoval.deleteMany.mockResolvedValueOnce({ count: 1 });
    prisma.companyRemoval.deleteMany.mockResolvedValueOnce({ count: 0 });

    await expect(repository.restore(cnpj)).resolves.toBe(true);
    await expect(repository.restore(cnpj)).resolves.toBe(false);
  });

  it('pagina a lista, da retirada mais recente para a mais antiga', async () => {
    prisma.companyRemoval.findMany.mockResolvedValue([
      { cnpj, removed_at: removedAt },
    ]);
    prisma.companyRemoval.count.mockResolvedValue(1);

    await expect(repository.list({ skip: 0, take: 20 })).resolves.toEqual({
      rows: [{ cnpj, removedAt }],
      total: 1,
    });
    expect(prisma.companyRemoval.findMany).toHaveBeenCalledWith({
      orderBy: [{ removed_at: 'desc' }, { cnpj: 'asc' }],
      skip: 0,
      take: 20,
    });
  });
});

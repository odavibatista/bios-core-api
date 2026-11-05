import { Injectable } from '@nestjs/common';
import { PrismaRepository } from '@shared/infra/database/prisma.repository.js';
import { PrismaService } from '@shared/infra/database/prisma.service.js';
import {
  type CompanyRemovalRecord,
  CompanyRemovalRepository,
} from '../../../domain/dtos/repositories/company-removal.repository.js';

function toRecord(row: {
  cnpj: string;
  removed_at: Date;
}): CompanyRemovalRecord {
  return { cnpj: row.cnpj, removedAt: row.removed_at };
}

@Injectable()
export class PrismaCompanyRemovalRepository
  extends PrismaRepository
  implements CompanyRemovalRepository
{
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  async isRemoved(cnpj: string): Promise<boolean> {
    const row = await this.prisma.companyRemoval.findUnique({
      where: { cnpj },
      select: { cnpj: true },
    });

    return row !== null;
  }

  async findAllCnpjs(): Promise<ReadonlySet<string>> {
    const rows = await this.prisma.companyRemoval.findMany({
      select: { cnpj: true },
    });

    return new Set(rows.map(({ cnpj }) => cnpj));
  }

  async remove(cnpj: string): Promise<CompanyRemovalRecord> {
    // A lista vem primeiro: uma coleta em andamento para de gravar antes de a limpeza terminar.
    const removal = await this.prisma.companyRemoval.upsert({
      where: { cnpj },
      create: { cnpj },
      update: {},
    });

    await Promise.all([
      this.prisma.companyProfile.deleteMany({ where: { cnpj } }),
      this.prisma.companyOdsScore.deleteMany({ where: { cnpj } }),
      this.prisma.companyMovement.deleteMany({ where: { cnpj } }),
      this.prisma.evidenceNormalized.deleteMany({ where: { cnpj } }),
      this.prisma.evidenceRaw.deleteMany({ where: { cnpj } }),
    ]);

    return toRecord(removal);
  }

  async restore(cnpj: string): Promise<boolean> {
    const { count } = await this.prisma.companyRemoval.deleteMany({
      where: { cnpj },
    });

    return count > 0;
  }

  async list({
    skip,
    take,
  }: {
    skip: number;
    take: number;
  }): Promise<{ rows: CompanyRemovalRecord[]; total: number }> {
    const [rows, total] = await Promise.all([
      this.prisma.companyRemoval.findMany({
        orderBy: [{ removed_at: 'desc' }, { cnpj: 'asc' }],
        skip,
        take,
      }),
      this.prisma.companyRemoval.count(),
    ]);

    return { rows: rows.map(toRecord), total };
  }
}

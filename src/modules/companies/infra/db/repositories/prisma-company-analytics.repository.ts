import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaRepository } from '@shared/infra/database/prisma.repository.js';
import { PrismaService } from '@shared/infra/database/prisma.service.js';
import {
  type AnalyticsOdsRow,
  CompanyAnalyticsRepository,
  type CompanyAnalyticsRows,
} from '../../../domain/dtos/repositories/company-analytics.repository.js';
import type { SearchCompaniesInput } from '../../../domain/dtos/repositories/company-profile.repository.js';
import {
  buildAnalyticsCnpjsPipeline,
  buildEvidenceAnalyticsPipeline,
  buildProfileAnalyticsPipeline,
  buildScoreAnalyticsPipeline,
} from './company-analytics.pipeline.js';

const BucketSchema = z.object({
  key: z.string().nullable(),
  count: z.number().int(),
});
const CountSchema = z.array(z.object({ count: z.number().int() }));

const ProfileFacetsSchema = z.array(
  z.object({
    companies: CountSchema,
    status: z.array(BucketSchema),
    size: z.array(BucketSchema),
    legalNature: z.array(BucketSchema.extend({ label: z.string().nullable() })),
    uf: z.array(BucketSchema),
    sector: z.array(BucketSchema),
  }),
);

const EvidenceFacetsSchema = z.array(
  z.object({
    totals: z.array(
      z.object({
        confirmed: z.number().int(),
        fineNotices: z.number().int(),
        fineAmount: z.number(),
        hectares: z.number(),
      }),
    ),
    biome: z.array(BucketSchema),
    infractionType: z.array(BucketSchema),
    sanction: z.array(BucketSchema),
    year: z.array(
      z.object({ year: z.number().int().nullable(), count: z.number().int() }),
    ),
  }),
);

const OdsRowsSchema = z.array(
  z.object({
    odsNumber: z.number().int(),
    companies: z.number().int(),
    averageScore: z.number().nullable(),
    averageConfidence: z.number().nullable(),
    scores: z.array(z.number()),
    confidences: z.array(z.number()),
  }),
);

const CnpjsSchema = z.array(z.object({ cnpj: z.string() }));

/**
 * Os três agregados do panorama, um por coleção. O conjunto de CNPJs sai sempre do perfil, para
 * não contar evidências de empresas que só a ingestão conhece e ninguém consultou.
 */
@Injectable()
export class PrismaCompanyAnalyticsRepository
  extends PrismaRepository
  implements CompanyAnalyticsRepository
{
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  async aggregate(
    input: Omit<SearchCompaniesInput, 'skip' | 'take'>,
  ): Promise<CompanyAnalyticsRows> {
    const cnpjs = await this.cnpjsOf(input);
    const [profiles, evidences, scores] = await Promise.all([
      this.prisma.companyProfile.aggregateRaw({
        pipeline: buildProfileAnalyticsPipeline(input),
      }),
      this.prisma.evidenceNormalized.aggregateRaw({
        pipeline: buildEvidenceAnalyticsPipeline(cnpjs),
      }),
      this.prisma.companyOdsScore.aggregateRaw({
        pipeline: buildScoreAnalyticsPipeline(cnpjs),
      }),
    ]);
    const [profile] = ProfileFacetsSchema.parse(profiles);
    const [evidence] = EvidenceFacetsSchema.parse(evidences);
    const totals = evidence?.totals[0];

    return {
      companies: profile?.companies[0]?.count ?? 0,
      totals: {
        confirmed_evidences: totals?.confirmed ?? 0,
        fine_notices: totals?.fineNotices ?? 0,
        fine_amount: totals?.fineAmount ?? 0,
        area_hectares: totals?.hectares ?? 0,
      },
      status: profile?.status ?? [],
      size: profile?.size ?? [],
      legalNature: (profile?.legalNature ?? []).map(
        ({ key, label, count }) => ({
          key,
          count,
          label: label ?? key ?? '',
        }),
      ),
      uf: profile?.uf ?? [],
      sector: profile?.sector ?? [],
      biome: evidence?.biome ?? [],
      infractionType: evidence?.infractionType ?? [],
      sanction: evidence?.sanction ?? [],
      year: evidence?.year ?? [],
      ods: OdsRowsSchema.parse(scores).map((row): AnalyticsOdsRow => ({
        ...row,
        companiesWithIndex: row.scores.length,
      })),
    };
  }

  private async cnpjsOf(
    input: Omit<SearchCompaniesInput, 'skip' | 'take'>,
  ): Promise<string[]> {
    const rows = await this.prisma.companyProfile.aggregateRaw({
      pipeline: buildAnalyticsCnpjsPipeline(input) as Prisma.InputJsonValue[],
    });

    return CnpjsSchema.parse(rows).map(({ cnpj }) => cnpj);
  }
}

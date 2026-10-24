import type { PrismaService } from '@shared/infra/database/prisma.service.js';

/** Índice e confiança a gravar para uma empresa em um ODS. */
export interface OdsScoreValues {
  /** Nulo: sem evidência conclusiva no ODS. */
  score: number | null;
  confidence: number;
}

/**
 * Grava o índice de uma empresa em um ODS **como o recálculo (UC15) o grava**: `uf`, `city` e
 * `cnae_codes` vêm do perfil cadastral (CNAE principal e secundários, sem repetir), e ficam
 * nulos/vazios quando a empresa não tem perfil — o caso dos CNPJs que só a ingestão do IBAMA
 * conhece. A pesquisa por ODS (#328) lê esses campos, então um índice de teste sem eles não
 * representaria o que a produção grava.
 */
export async function saveOdsScore(
  prisma: PrismaService,
  cnpj: string,
  odsNumber: number,
  { score, confidence }: OdsScoreValues,
): Promise<void> {
  const [ods, profile] = await Promise.all([
    prisma.ods.findUniqueOrThrow({ where: { ods_number: odsNumber } }),
    prisma.companyProfile.findUnique({
      where: { cnpj },
      select: { address: true, main_cnae: true, secondary_cnaes: true },
    }),
  ]);

  await prisma.companyOdsScore.create({
    data: {
      cnpj,
      ods_id: ods.id_ods,
      ods_number: odsNumber,
      score_value: score,
      confidence_value: confidence,
      evidence_count: 0,
      contributions: [],
      sources_without_records: [],
      rules_version: 'rf10-rf11-v3',
      uf: profile?.address.uf ?? null,
      city: profile?.address.city ?? null,
      cnae_codes: profile
        ? [
            ...new Set([
              profile.main_cnae.code,
              ...profile.secondary_cnaes.map(({ code }) => code),
            ]),
          ]
        : [],
      calculated_at: new Date(),
    },
  });
}

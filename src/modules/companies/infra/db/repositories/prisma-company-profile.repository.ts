import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaRepository } from '@shared/infra/database/prisma.repository.js';
import { PrismaService } from '@shared/infra/database/prisma.service.js';
import { z } from 'zod';
import {
  CompanyProfileRepository,
  type SaveCompanyProfileInput,
  type SearchCompaniesInput,
  type SearchCompaniesResult,
  type StoredCompanyProfile,
} from '../../../domain/dtos/repositories/company-profile.repository.js';
import {
  type CompanySearchItem,
  CompanySearchItemSchema,
} from '../../../domain/dtos/requests/search-companies.dto.js';
import {
  buildScoredCnpjsPipeline,
  buildScoredCountPipeline,
  buildScoredFilteredPipeline,
  buildScoredPagePipeline,
  canSearchFromScores,
  type ScoredSearchInput,
} from './company-scored-search.pipeline.js';
import {
  buildCompanyCountPipeline,
  buildCompanySearchPipeline,
  type CompanySearchPipelineOptions,
} from './company-search.pipeline.js';

/** Resposta do `$facet` da pesquisa: a janela e a contagem total. */
const SearchFacetsSchema = z.object({
  items: z.array(CompanySearchItemSchema),
  total: z.array(z.object({ count: z.number().int() })),
});

/** Resposta de um `$count`: uma linha com o total, ou nenhuma quando nada casou. */
const CountSchema = z.array(z.object({ count: z.number().int() }));

/** Linhas só com o CNPJ (os que já aparecem em outro segmento da lista). */
const CnpjsSchema = z.array(z.object({ cnpj: z.string() }));

/**
 * Perfil cadastral das empresas no MongoDB.
 *
 * Só campos de pessoa jurídica existem na coleção (INL02), e é só o que este
 * repositório lê e grava. Na atualização, um campo que deixou de existir na
 * fonte (o nome fantasia, por exemplo) é gravado como `null`, e não omitido:
 * omitir deixaria o valor antigo no documento.
 */
@Injectable()
export class PrismaCompanyProfileRepository
  extends PrismaRepository
  implements CompanyProfileRepository
{
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  async findByCnpj(cnpj: string): Promise<StoredCompanyProfile | null> {
    const company = await this.prisma.companyProfile.findUnique({
      where: { cnpj },
      include: { cadastral_source: { select: { slug: true } } },
    });

    if (!company) return null;

    return {
      cadastralSourceSlug: company.cadastral_source.slug,
      refreshedAt: company.refreshed_at,
      contentHash: company.content_hash,
      previousContentHash: company.previous_content_hash ?? null,
      profile: {
        cnpj: company.cnpj,
        legal_name: company.legal_name,
        trade_name: company.trade_name ?? null,
        registration_status: company.registration_status,
        company_size: company.company_size ?? null,
        address: {
          street: company.address.street ?? null,
          number: company.address.number ?? null,
          complement: company.address.complement ?? null,
          neighborhood: company.address.neighborhood ?? null,
          city: company.address.city,
          city_ibge_code: company.address.city_ibge_code ?? null,
          uf: company.address.uf,
          zipcode: company.address.zipcode ?? null,
        },
        main_cnae: {
          code: company.main_cnae.code,
          description: company.main_cnae.description,
        },
        secondary_cnaes: company.secondary_cnaes.map(
          ({ code, description }) => ({ code, description }),
        ),
        refreshed_at: company.refreshed_at.toISOString(),
      },
    };
  }

  async search(input: SearchCompaniesInput): Promise<SearchCompaniesResult> {
    if (!canSearchFromScores(input)) return this.searchFromProfiles(input);

    return input.ods.order === undefined
      ? this.searchFilteredByScore(input)
      : this.searchOrderedByScore(input);
  }

  /** Pesquisa que parte do perfil: sem ODS, com nome, ou com ODS que só aparece na página. */
  private async searchFromProfiles(
    input: SearchCompaniesInput,
    options?: CompanySearchPipelineOptions,
  ): Promise<SearchCompaniesResult> {
    // O Prisma não expressa expressão regular com `$facet`; o pipeline vai cru.
    const raw = await this.prisma.companyProfile.aggregateRaw({
      pipeline: buildCompanySearchPipeline(input, options),
    });
    const [facets] = z.array(SearchFacetsSchema).parse(raw);

    return {
      items: facets?.items ?? [],
      total: facets?.total[0]?.count ?? 0,
    };
  }

  /** Mínimos sem ordenação pelo ODS: os índices que passam, juntados ao perfil. */
  private async searchFilteredByScore(
    input: ScoredSearchInput,
  ): Promise<SearchCompaniesResult> {
    const raw = await this.prisma.companyOdsScore.aggregateRaw({
      pipeline: buildScoredFilteredPipeline(input),
    });
    const [facets] = z.array(SearchFacetsSchema).parse(raw);

    return {
      items: facets?.items ?? [],
      total: facets?.total[0]?.count ?? 0,
    };
  }

  /**
   * Ordenação pelo ODS: primeiro as empresas com nota, em ordem de índice, direto do índice
   * composto; depois as sem nota, por razão social. A janela pedida cai no primeiro
   * segmento, no segundo ou na emenda dos dois, e o segundo só é lido quando a página chega
   * nele.
   */
  private async searchOrderedByScore(
    input: ScoredSearchInput,
  ): Promise<SearchCompaniesResult> {
    const { ods, skip, take } = input;
    const scoredTotal = await this.countScores(
      buildScoredCountPipeline(input, 'scored'),
    );
    const unscored = await this.planUnscoredSegment(input, scoredTotal);
    const items: CompanySearchItem[] = [];
    const scoredTake = Math.max(0, Math.min(take, scoredTotal - skip));

    if (scoredTake > 0) {
      const raw = await this.prisma.companyOdsScore.aggregateRaw({
        pipeline: buildScoredPagePipeline(input, skip, scoredTake),
      });

      items.push(...z.array(CompanySearchItemSchema).parse(raw));
    }

    const remaining = take - scoredTake;

    if (remaining > 0 && unscored.total > 0) {
      const page = await this.searchFromProfiles(
        {
          ...input,
          ods: { number: ods.number },
          skip: Math.max(0, skip - scoredTotal),
          take: remaining,
        },
        await unscored.options(),
      );

      items.push(...page.items);
    }

    return { items, total: scoredTotal + unscored.total };
  }

  /**
   * O segmento das empresas sem nota: quantas são e como a leitura dele se limita.
   * Com `minScore` ninguém sem nota passa; com só `minConfidence`, passam as que têm
   * índice sem nota e confiança suficiente; sem mínimo, é toda a base menos as que têm nota.
   */
  private async planUnscoredSegment(
    input: ScoredSearchInput,
    scoredTotal: number,
  ): Promise<{
    total: number;
    options: () => Promise<CompanySearchPipelineOptions>;
  }> {
    const { minScore, minConfidence } = input.ods;

    if (minScore !== undefined) {
      return { total: 0, options: () => Promise.resolve({}) };
    }

    if (minConfidence !== undefined) {
      const includeCnpjs = await this.scoreCnpjs(
        buildScoredCnpjsPipeline(input, 'unscored'),
      );

      return {
        total: includeCnpjs.length,
        options: () => Promise.resolve({ includeCnpjs }),
      };
    }

    const raw = await this.prisma.companyProfile.aggregateRaw({
      pipeline: buildCompanyCountPipeline(input),
    });
    const profileTotal = CountSchema.parse(raw)[0]?.count ?? 0;

    return {
      total: Math.max(0, profileTotal - scoredTotal),
      options: async () => ({
        excludeCnpjs: await this.scoreCnpjs(
          buildScoredCnpjsPipeline(input, 'scored'),
        ),
      }),
    };
  }

  private async countScores(
    pipeline: ReturnType<typeof buildScoredCountPipeline>,
  ): Promise<number> {
    const raw = await this.prisma.companyOdsScore.aggregateRaw({ pipeline });

    return CountSchema.parse(raw)[0]?.count ?? 0;
  }

  private async scoreCnpjs(
    pipeline: ReturnType<typeof buildScoredCnpjsPipeline>,
  ): Promise<string[]> {
    const raw = await this.prisma.companyOdsScore.aggregateRaw({ pipeline });

    return CnpjsSchema.parse(raw).map(({ cnpj }) => cnpj);
  }

  async save({
    record,
    sourceSlug,
    contentHash,
    previousContentHash,
    refreshedAt,
  }: SaveCompanyProfileInput): Promise<void> {
    const { id_data_source } = await this.prisma.dataSource.findUniqueOrThrow({
      where: { slug: sourceSlug },
      select: { id_data_source: true },
    });
    const { address } = record;
    const data = {
      legal_name: record.legalName,
      trade_name: record.tradeName,
      registration_status: record.registrationStatus,
      company_size: record.companySize,
      address: {
        street: address.street,
        number: address.number,
        complement: address.complement,
        neighborhood: address.neighborhood,
        city: address.city,
        city_ibge_code: address.cityIbgeCode,
        uf: address.uf,
        zipcode: address.zipcode,
      },
      main_cnae: {
        code: record.mainCnae.code,
        description: record.mainCnae.description,
      },
      secondary_cnaes: record.secondaryCnaes.map(({ code, description }) => ({
        code,
        description,
      })),
      cadastral_source_id: id_data_source,
      content_hash: contentHash,
      previous_content_hash: previousContentHash,
      refreshed_at: refreshedAt,
    } satisfies Prisma.CompanyProfileUncheckedUpdateInput;

    await this.prisma.companyProfile.upsert({
      where: { cnpj: record.cnpj },
      create: { cnpj: record.cnpj, ...data },
      update: data,
    });
  }
}

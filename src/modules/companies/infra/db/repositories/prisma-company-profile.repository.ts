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
import { CompanySearchItemSchema } from '../../../domain/dtos/requests/search-companies.dto.js';
import { buildCompanySearchPipeline } from './company-search.pipeline.js';

/** Resposta do `$facet` da pesquisa: a janela e a contagem total. */
const SearchFacetsSchema = z.object({
  items: z.array(CompanySearchItemSchema),
  total: z.array(z.object({ count: z.number().int() })),
});

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
    // O Prisma não expressa expressão regular com `$facet`; o pipeline vai cru.
    const raw = await this.prisma.companyProfile.aggregateRaw({
      pipeline: buildCompanySearchPipeline(input),
    });
    const [facets] = z.array(SearchFacetsSchema).parse(raw);

    return {
      items: facets?.items ?? [],
      total: facets?.total[0]?.count ?? 0,
    };
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

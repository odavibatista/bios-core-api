import { Injectable } from '@nestjs/common';
import { PrismaRepository } from '@shared/infra/database/prisma.repository.js';
import { PrismaService } from '@shared/infra/database/prisma.service.js';
import {
  CompanyProfileRepository,
  type StoredCompanyProfile,
} from '../../../domain/dtos/repositories/company-profile.repository.js';

/**
 * Perfil cadastral das empresas no MongoDB.
 *
 * Somente leitura: `company_profile` é escrita pelo serviço de ingestão do
 * CNPJ. Só campos de pessoa jurídica existem na coleção (INL02), e é só o que
 * este repositório devolve.
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
      profile: {
        cnpj: company.cnpj,
        legal_name: company.legal_name,
        trade_name: company.trade_name,
        registration_status: company.registration_status,
        company_size: company.company_size,
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
}

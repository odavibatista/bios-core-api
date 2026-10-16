import type { StoredCompanyProfile } from '@modules/companies/domain/dtos/repositories/company-profile.repository.js';
import type { CompanyProfileResponse } from '@modules/companies/domain/dtos/requests/company-profile.dto.js';
import { faker } from '../../support/faker.js';
import { defineFactory } from '../factory.js';

/** CNPJs válidos de domínio público, para testes que precisam de um CNPJ real. */
export const VALID_CNPJS = [
  '11222333000181',
  '00000000000191',
  '33000167000101',
  '60746948000112',
] as const;

/** Um CNPJ válido, sorteado. */
export function buildCnpj(): string {
  return faker.helpers.arrayElement(VALID_CNPJS);
}

function buildCnae() {
  return {
    code: faker.string.numeric(7),
    description: faker.commerce.department(),
  };
}

/** Perfil cadastral no formato em que a API o expõe. */
export const companyProfileResponseFactory =
  defineFactory<CompanyProfileResponse>(() => ({
    cnpj: buildCnpj(),
    legal_name: faker.company.name(),
    trade_name: faker.company.name(),
    registration_status: 'ATIVA',
    company_size: 'DEMAIS',
    address: {
      street: faker.location.street(),
      number: faker.string.numeric(3),
      complement: null,
      neighborhood: faker.location.county(),
      city: faker.location.city(),
      city_ibge_code: faker.string.numeric(7),
      uf: 'SP',
      zipcode: faker.string.numeric(8),
    },
    main_cnae: buildCnae(),
    secondary_cnaes: [buildCnae(), buildCnae()],
    refreshed_at: faker.date.recent().toISOString(),
  }));

/** Perfil guardado, com a fonte que o respondeu e a data da atualização. */
export const storedCompanyProfileFactory = defineFactory<StoredCompanyProfile>(
  () => {
    const refreshedAt = faker.date.recent({ days: 1 });

    return {
      profile: companyProfileResponseFactory.build({
        refreshed_at: refreshedAt.toISOString(),
      }),
      cadastralSourceSlug: 'BRASIL_API',
      refreshedAt,
      contentHash: faker.string.hexadecimal({ length: 64, prefix: '' }),
      previousContentHash: null,
    };
  },
);

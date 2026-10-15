import type { CompanyProfileResponse } from '../requests/company-profile.dto.js';

/**
 * Contrato do controller de empresas.
 */
export interface CompaniesControllerInterface {
  getCompanyProfile(cnpj: string): Promise<CompanyProfileResponse>;
}

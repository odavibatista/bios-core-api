import type { CompanyFullProfileResponse } from '../requests/company-full-profile.dto.js';

/** Contrato dos controllers do perfil completo (painel e API pública). */
export interface CompanyFullProfileControllerInterface {
  getCompanyProfile(cnpj: string): Promise<CompanyFullProfileResponse>;
}

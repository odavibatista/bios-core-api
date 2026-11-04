import type { StreamableFile } from '@nestjs/common';
import type {
  CompanyMovementsQuery,
  CompanyMovementsResponse,
} from '../requests/company-movements.dto.js';
import type {
  ExportCompaniesQuery,
  SearchCompaniesQuery,
  SearchCompaniesResponse,
} from '../requests/search-companies.dto.js';

/**
 * Contrato da busca de empresas, que só existe no painel (a API pública do
 * UC12 consulta por CNPJ).
 */
export interface CompaniesSearchControllerInterface {
  searchCompanies(
    query: SearchCompaniesQuery,
  ): Promise<SearchCompaniesResponse>;
}

/** Contrato da lista de movimentações da tela principal (UC18). */
export interface CompanyMovementsControllerInterface {
  listCompanyMovements(
    query: CompanyMovementsQuery,
  ): Promise<CompanyMovementsResponse>;
}

/** Contrato da exportação da lista de empresas em XLSX (UC09). */
export interface CompaniesExportControllerInterface {
  exportCompanies(query: ExportCompaniesQuery): Promise<StreamableFile>;
}

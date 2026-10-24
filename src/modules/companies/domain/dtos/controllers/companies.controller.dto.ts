import type { StreamableFile } from '@nestjs/common';
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

/** Contrato da exportação da lista de empresas em XLSX (UC09). */
export interface CompaniesExportControllerInterface {
  exportCompanies(query: ExportCompaniesQuery): Promise<StreamableFile>;
}

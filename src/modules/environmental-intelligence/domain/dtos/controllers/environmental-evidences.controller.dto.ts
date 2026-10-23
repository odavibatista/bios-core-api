import type {
  CompanyEnvironmentalEvidencesRequest,
  CompanyEnvironmentalEvidencesResponse,
} from '@modules/evidences/domain/dtos/requests/company-evidences.dto.js';
/** Consulta autenticada das evidências e de suas referências originais (RF09). */
export interface EnvironmentalEvidencesControllerInterface {
  getCompanyEvidences(
    params: CompanyEnvironmentalEvidencesRequest,
  ): Promise<CompanyEnvironmentalEvidencesResponse>;
}

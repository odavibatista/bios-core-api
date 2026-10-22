import type {
  CompanyEnvironmentalEvidencesRequest,
  CompanyEnvironmentalEvidencesResponse,
} from '../requests/company-evidences.dto.js';
/** Consulta autenticada das evidências e de suas referências originais (RF09). */
export interface EvidencesControllerInterface {
  getCompanyEvidences(
    params: CompanyEnvironmentalEvidencesRequest,
  ): Promise<CompanyEnvironmentalEvidencesResponse>;
}

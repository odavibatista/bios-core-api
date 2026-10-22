import type { z } from 'zod';
import { CompanyEnvironmentalEvidencesRequestSchema } from '../../company-environmental-evidences.dto.js';
export {
  CompanyEnvironmentalEvidencesRequestSchema,
  CompanyEnvironmentalEvidencesResponseSchema,
  type CompanyEnvironmentalEvidencesResponse,
} from '../../company-environmental-evidences.dto.js';
export type CompanyEnvironmentalEvidencesRequest = z.infer<
  typeof CompanyEnvironmentalEvidencesRequestSchema
>;

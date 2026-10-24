import type { CompanyFullProfileResponse } from '@modules/environmental-intelligence/domain/dtos/requests/company-full-profile.dto.js';
import type { CompanyOdsScore } from '@modules/scoring/domain/dtos/requests/company-ods-scores.dto.js';
import { defineFactory } from '../factory.js';
import { companyProfileResponseFactory } from './company-profile.factory.js';

/** Índice de um ODS ainda sem retrato calculado. */
export const pendingOdsScoreFactory = defineFactory<CompanyOdsScore>(() => ({
  ods_number: 13,
  calculation_status: 'PENDING',
  index_status: 'UNAVAILABLE',
  score_value: null,
  confidence_value: null,
  evidence_count: null,
  coverage_status: null,
  sources_without_records: [],
  rules_version: null,
  calculated_at: null,
  contributions: [],
}));

/** Índice de um ODS calculado sem nenhum registro nas fontes (sem nota, sem contribuições). */
export const calculatedOdsScoreFactory = defineFactory<CompanyOdsScore>(() => ({
  ods_number: 13,
  calculation_status: 'CALCULATED',
  index_status: 'UNAVAILABLE',
  score_value: null,
  confidence_value: 0,
  evidence_count: 0,
  coverage_status: 'NO_DATA',
  sources_without_records: [],
  rules_version: 'rf10-rf11-v3',
  calculated_at: '2026-10-20T10:00:00.000Z',
  contributions: [],
}));

/** Perfil completo: cadastro na raiz, sem evidências e com os dois ODS pendentes. */
export const companyFullProfileResponseFactory =
  defineFactory<CompanyFullProfileResponse>(() => ({
    ...companyProfileResponseFactory.build(),
    evidences: [],
    ods_scores: [
      pendingOdsScoreFactory.build({ ods_number: 13 }),
      pendingOdsScoreFactory.build({ ods_number: 15 }),
    ],
  }));

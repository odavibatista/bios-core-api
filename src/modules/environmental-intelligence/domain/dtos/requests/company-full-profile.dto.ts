import { z } from 'zod';
import { CompanyProfileResponseSchema } from '@modules/companies/domain/dtos/requests/company-profile.dto.js';
import { CompanyEnvironmentalEvidencesResponseSchema } from '@modules/evidences/domain/dtos/requests/company-evidences.dto.js';
import { CompanyOdsScoreSchema } from '@modules/scoring/domain/dtos/requests/company-ods-scores.dto.js';

/**
 * Perfil completo de uma empresa (UC06 + UC07, RF05–RF12).
 *
 * O cadastro vem na raiz, com os mesmos campos de antes, de modo que quem lia só o
 * cadastro segue funcionando; as evidências agrupadas por categoria e os índices por ODS
 * acompanham. O BIOS não afirma que a empresa "é" ou "não é" sustentável (IND01): o
 * índice de cada ODS é separado, com a confiança ao lado e nunca combinada, e os ODS 13 e
 * 15 não formam índice geral (regra 4 do UC07).
 */
export const CompanyFullProfileResponseSchema =
  CompanyProfileResponseSchema.extend({
    evidences:
      CompanyEnvironmentalEvidencesResponseSchema.shape.categories.describe(
        'Evidências ambientais agrupadas por categoria, com a referência da fonte original',
      ),
    ods_scores: z
      .array(CompanyOdsScoreSchema)
      .describe('Índice, confiança e explicação por ODS, em ordem de número'),
  }).describe(
    'Perfil completo da empresa: cadastro, evidências e índices por ODS',
  );

export type CompanyFullProfileResponse = z.infer<
  typeof CompanyFullProfileResponseSchema
>;

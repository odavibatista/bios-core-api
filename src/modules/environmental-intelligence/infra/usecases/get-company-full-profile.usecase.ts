import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { GetCompanyProfileUseCase } from '@modules/companies/infra/usecases/get-company-profile.usecase.js';
import { CompanyEnvironmentalEvidencesResponseSchema } from '@modules/evidences/domain/dtos/requests/company-evidences.dto.js';
import {
  CompanyOdsScoreSchema,
  type CompanyOdsScore,
} from '@modules/scoring/domain/dtos/requests/company-ods-scores.dto.js';
import { GetCompanyOdsScoresUseCase } from '@modules/scoring/infra/usecases/get-company-ods-scores.usecase.js';
import {
  type CacheKey,
  CacheNamespace,
} from '@shared/domain/dtos/providers/cache-key.dto.js';
import { UseCase } from '@shared/domain/protocols/use-case.protocol.js';
import { CacheProvider } from '@shared/domain/providers/cache.provider.js';
import {
  CompanyFullProfileResponseSchema,
  type CompanyFullProfileResponse,
} from '../../domain/dtos/requests/company-full-profile.dto.js';
import { GetCompanyEnvironmentalEvidencesUseCase } from './get-company-environmental-evidences.usecase.js';

/**
 * Validade, em segundos, das partes ambientais guardadas em cache.
 *
 * Curta de propósito: o cache é apagado quando o índice da empresa é recalculado
 * (`OdsScoringProcessor`), mas a validade das evidências também passa com o tempo,
 * sem job algum, e o prazo limita por quanto tempo uma leitura pode envelhecer.
 */
export const ENVIRONMENTAL_PROFILE_CACHE_TTL_SECONDS = 300;

const isCalculated = ({ calculation_status }: CompanyOdsScore): boolean =>
  calculation_status === 'CALCULATED';

/** Partes ambientais do perfil, guardadas e apagadas juntas. */
const EvidencesCacheSchema =
  CompanyEnvironmentalEvidencesResponseSchema.shape.categories;
const ScoresCacheSchema = z.array(CompanyOdsScoreSchema);

/**
 * Compõe o perfil completo de uma empresa (UC06 + UC07).
 *
 * Três etapas, nesta ordem, e cada uma só roda se a anterior deu certo:
 *
 *  1. **Cadastro** (UC06): cache, banco ou fila. É ele que responde CNPJ inválido (422),
 *     empresa inexistente (404) e fontes cadastrais fora do ar sem cadastro guardado
 *     (503), antes de qualquer coleta ambiental;
 *  2. **Evidências** (UC07): consolida IBAMA, CGU e GHG, cada fonte degradando por conta
 *     própria, e pede o recálculo dos índices (UC15), esperando no prazo da fila;
 *  3. **Índices por ODS**: lê os retratos gravados, com a explicação de cada um.
 *
 * **Cache.** As etapas 2 e 3 só rodam quando as duas partes não estão em cache
 * (`company-evidences` e `company-scores`, apagadas juntas pelo recálculo do índice). Só
 * se guarda perfil com todos os índices calculados: ODS pendente (recálculo atrasado ou
 * falho) é refeito na consulta seguinte, em vez de congelar a lacuna. Evidência `UNKNOWN`
 * não impede o cache: a janela de reconsulta dela é das próprias fontes (15 minutos), e o
 * fim de uma coleta pendente dispara o recálculo, que apaga o cache.
 *
 * Mora aqui, e não em `companies`, porque o módulo de empresas não pode depender da
 * orquestração ambiental (o sentido das dependências vai da orquestração para baixo).
 */
@Injectable()
export class GetCompanyFullProfileUseCase extends UseCase<
  string,
  CompanyFullProfileResponse
> {
  constructor(
    private readonly profile: GetCompanyProfileUseCase,
    private readonly evidences: GetCompanyEnvironmentalEvidencesUseCase,
    private readonly scores: GetCompanyOdsScoresUseCase,
    private readonly cache: CacheProvider,
  ) {
    super();
  }

  override async execute(input: string): Promise<CompanyFullProfileResponse> {
    const profile = await this.profile.execute(input);
    const evidencesKey: CacheKey = {
      namespace: CacheNamespace.COMPANY_EVIDENCES,
      identifier: profile.cnpj,
    };
    const scoresKey: CacheKey = {
      namespace: CacheNamespace.COMPANY_SCORES,
      identifier: profile.cnpj,
    };

    const cachedEvidences = EvidencesCacheSchema.safeParse(
      await this.cache.get<unknown>(evidencesKey),
    );
    const cachedScores = ScoresCacheSchema.safeParse(
      await this.cache.get<unknown>(scoresKey),
    );

    if (cachedEvidences.success && cachedScores.success) {
      return CompanyFullProfileResponseSchema.parse({
        ...profile,
        evidences: cachedEvidences.data,
        ods_scores: cachedScores.data,
      });
    }

    const { categories } = await this.evidences.execute(profile.cnpj);
    const odsScores = await this.scores.execute(profile.cnpj);
    const full = CompanyFullProfileResponseSchema.parse({
      ...profile,
      evidences: categories,
      ods_scores: odsScores,
    });

    if (full.ods_scores.every(isCalculated)) {
      await Promise.all([
        this.cache.set(
          evidencesKey,
          full.evidences,
          ENVIRONMENTAL_PROFILE_CACHE_TTL_SECONDS,
        ),
        this.cache.set(
          scoresKey,
          full.ods_scores,
          ENVIRONMENTAL_PROFILE_CACHE_TTL_SECONDS,
        ),
      ]);
    }

    return full;
  }
}

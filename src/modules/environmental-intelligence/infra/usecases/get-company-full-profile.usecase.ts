import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EvidenceState } from '@prisma/client';
import { z } from 'zod';
import { GetCompanyProfileUseCase } from '@modules/companies/infra/usecases/get-company-profile.usecase.js';
import { CompanyEnvironmentalEvidencesResponseSchema } from '@modules/evidences/domain/dtos/requests/company-evidences.dto.js';
import {
  ENVIRONMENTAL_SOURCE_SLUGS,
  groupCompanyEvidences,
} from '@modules/evidences/domain/company-environmental-evidences.dto.js';
import { ListCompanyEvidencesUseCase } from '@modules/evidences/infra/usecases/list-company-evidences.usecase.js';
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
import type { Environment } from '@shared/config/environment.config.js';
import { CacheProvider } from '@shared/domain/providers/cache.provider.js';
import {
  CompanyFullProfileResponseSchema,
  type CompanyFullProfileResponse,
} from '../../domain/dtos/requests/company-full-profile.dto.js';
import { CompanyDataUnavailableException } from '@modules/companies/domain/dtos/errors/company-data-unavailable.exception.js';
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

const TIMEOUT = Symbol('profile-timeout');

async function within<T>(
  work: Promise<T>,
  milliseconds: number,
): Promise<T | typeof TIMEOUT> {
  if (milliseconds <= 0) {
    void work.catch(() => undefined);
    return TIMEOUT;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<typeof TIMEOUT>((resolve) => {
        timer = setTimeout(() => resolve(TIMEOUT), milliseconds);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

type Categories = z.infer<typeof EvidencesCacheSchema>;

function provenance(
  categories: Categories,
  startedAt: number,
  collectionPending: boolean,
  scoresPending: boolean,
) {
  const evidences = categories.flatMap(({ evidences }) => evidences);
  const sources = ENVIRONMENTAL_SOURCE_SLUGS.map((source_slug) => {
    const rows = evidences.filter(
      (evidence) => evidence.source_slug === source_slug,
    );
    const state =
      rows.find((row) => row.state === EvidenceState.CONFIRMED)?.state ??
      rows.find((row) => row.state === EvidenceState.NOT_FOUND)?.state ??
      rows[0]?.state ??
      null;
    const newestCollection = rows.reduce(
      (latest, row) => Math.max(latest, Date.parse(row.collected_at)),
      0,
    );
    const origin =
      state === EvidenceState.UNKNOWN || (!state && !collectionPending)
        ? 'UNAVAILABLE'
        : !state && collectionPending
          ? 'PENDING'
          : newestCollection >= startedAt
            ? 'COLLECTION'
            : 'PERSISTED';
    return { source_slug, origin, evidence_state: state };
  });
  return {
    sources,
    scores_pending: scoresPending,
    retry_after_seconds:
      scoresPending || sources.some(({ origin }) => origin === 'PENDING')
        ? 30
        : sources.some(({ origin }) => origin === 'UNAVAILABLE')
          ? 900
          : null,
  };
}

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
    private readonly list: ListCompanyEvidencesUseCase,
    private readonly config: ConfigService<Environment, true>,
  ) {
    super();
  }

  override async execute(input: string): Promise<CompanyFullProfileResponse> {
    const startedAt = Date.now();
    const budget = this.config.get('COMPANY_PROFILE_REQUEST_TIMEOUT_MS', {
      infer: true,
    });
    const queueWait = this.config.get('QUEUE_WAIT_TIMEOUT_MS', { infer: true });
    const deadline = startedAt + budget;
    // Reserva tempo para reler o retrato persistido e montar a resposta parcial.
    const profile = await within(
      this.profile.execute(input, Math.min(queueWait, budget - 1_000)),
      budget - 750,
    );
    if (profile === TIMEOUT) throw new CompanyDataUnavailableException();
    const evidencesKey: CacheKey = {
      namespace: CacheNamespace.COMPANY_EVIDENCES,
      identifier: profile.cnpj,
    };
    const scoresKey: CacheKey = {
      namespace: CacheNamespace.COMPANY_SCORES,
      identifier: profile.cnpj,
    };

    const cached = await within(
      Promise.all([
        this.cache.get<unknown>(evidencesKey),
        this.cache.get<unknown>(scoresKey),
      ]),
      deadline - Date.now() - 500,
    );
    const cachedEvidences = EvidencesCacheSchema.safeParse(
      cached === TIMEOUT ? null : cached[0],
    );
    const cachedScores = ScoresCacheSchema.safeParse(
      cached === TIMEOUT ? null : cached[1],
    );

    if (cachedEvidences.success && cachedScores.success) {
      return CompanyFullProfileResponseSchema.parse({
        ...profile,
        evidences: cachedEvidences.data,
        ods_scores: cachedScores.data,
        provenance: provenance(cachedEvidences.data, startedAt, false, false),
      });
    }

    const collected = await within(
      this.evidences.execute(profile.cnpj),
      deadline - Date.now() - 500,
    );
    const local =
      collected === TIMEOUT
        ? await within(
            this.list.execute(profile.cnpj),
            deadline - Date.now() - 250,
          )
        : null;
    const categories =
      collected === TIMEOUT
        ? groupCompanyEvidences(
            profile.cnpj,
            local === TIMEOUT ? [] : (local ?? []),
          ).categories
        : collected.categories;
    const readScores = await within(
      this.scores.execute(profile.cnpj),
      deadline - Date.now(),
    );
    const odsScores = readScores === TIMEOUT ? [] : readScores;
    const collectionPending = collected === TIMEOUT || local === TIMEOUT;
    const scoresPending =
      readScores === TIMEOUT || odsScores.some((score) => !isCalculated(score));
    const pending = collectionPending || scoresPending;
    const full = CompanyFullProfileResponseSchema.parse({
      ...profile,
      evidences: categories,
      ods_scores: odsScores,
      provenance: provenance(
        categories,
        startedAt,
        collectionPending,
        scoresPending,
      ),
    });

    if (!pending) {
      await within(
        Promise.all([
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
        ]),
        deadline - Date.now(),
      );
    }

    return full;
  }
}

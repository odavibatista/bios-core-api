import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EvidenceState } from '@prisma/client';
import { z } from 'zod';
import { GetCompanyProfileUseCase } from '@modules/companies/infra/usecases/get-company-profile.usecase.js';
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
import {
  companyEvidencesCacheKey,
  ENVIRONMENTAL_PROFILE_CACHE_TTL_SECONDS,
  EvidencesCacheSchema,
  GetCompanyEnvironmentalEvidencesUseCase,
} from './get-company-environmental-evidences.usecase.js';

/**
 * Por quanto tempo, no modo sem espera, um `UNKNOWN` recém-gravado ainda é tratado como
 * atualização em andamento (`PENDING`) e não como fonte indisponível (`UNAVAILABLE`): é o
 * marcador que a consulta deixa antes de publicar o job, e o job pode estar na fila ou rodando.
 */
export const PENDING_REFRESH_WINDOW_MS = 120_000;

/** Opções da composição do perfil completo. */
export interface FullProfileOptions {
  /**
   * Espera as coletas das fontes e o recálculo dos índices, no prazo da fila (padrão: o
   * painel). Falso (API pública, #333): serve o que está guardado, publica as atualizações
   * que faltam e marca o que ainda está pendente, sem esperar nenhuma fonte externa.
   */
  waitForCollection?: boolean;
}

const isCalculated = ({ calculation_status }: CompanyOdsScore): boolean =>
  calculation_status === 'CALCULATED';

/** Notas guardadas com as evidências e apagadas junto com elas pelo recálculo. */
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
  background = false,
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
    const refreshing =
      background && Date.now() - newestCollection <= PENDING_REFRESH_WINDOW_MS;
    const origin =
      state === EvidenceState.UNKNOWN
        ? refreshing
          ? 'PENDING'
          : 'UNAVAILABLE'
        : !state
          ? collectionPending || background
            ? 'PENDING'
            : 'UNAVAILABLE'
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
 * (`company-evidences` e `company-scores`, apagadas juntas pelo recálculo do índice). O
 * retrato das evidências é o mesmo da rota de evidências (#334): a consolidação também o lê
 * e o grava, então o perfil e aquela rota mostram as mesmas evidências na janela. Só
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

  override async execute(
    input: string,
    { waitForCollection = true }: FullProfileOptions = {},
  ): Promise<CompanyFullProfileResponse> {
    const background = !waitForCollection;
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
    const evidencesKey = companyEvidencesCacheKey(profile.cnpj);
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
      this.evidences.execute(profile.cnpj, { wait: waitForCollection }),
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
    const newestEvidence = categories
      .flatMap(({ evidences }) => evidences)
      .reduce(
        (latest, { collected_at }) =>
          Math.max(latest, Date.parse(collected_at)),
        0,
      );
    // Sem espera, o índice lido pode ser de antes da última coleta: enquanto o recálculo
    // pedido não termina, ele vale como pendente, e não como o retrato atual das evidências.
    const staleScores =
      background &&
      odsScores.some(
        ({ calculated_at }) =>
          calculated_at !== null && Date.parse(calculated_at) < newestEvidence,
      );
    const scoresPending =
      readScores === TIMEOUT ||
      staleScores ||
      odsScores.some((score) => !isCalculated(score));
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
        background,
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

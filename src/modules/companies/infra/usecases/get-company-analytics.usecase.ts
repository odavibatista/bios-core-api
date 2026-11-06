import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EnsureActiveOdsUseCase } from '@modules/scoring/infra/usecases/ensure-active-ods.usecase.js';
import type { Environment } from '@shared/config/environment.config.js';
import {
  type CacheKey,
  CacheNamespace,
} from '@shared/domain/dtos/providers/cache-key.dto.js';
import { UseCase } from '@shared/domain/protocols/use-case.protocol.js';
import { CacheProvider } from '@shared/domain/providers/cache.provider.js';
import { toCompanyAnalytics } from '../../domain/company-analytics.js';
import { CompanyAnalyticsRepository } from '../../domain/dtos/repositories/company-analytics.repository.js';
import type { CompanyAnalytics } from '../../domain/dtos/requests/company-analytics.dto.js';
import type { CompanyAnalyticsQuery } from '../../domain/dtos/requests/search-companies.dto.js';
import { toSearchInput } from '../../domain/search-companies-input.js';
import { hasAnalyticsCriteria } from '../db/repositories/company-analytics.pipeline.js';
import { ResolveSelectedCityUseCase } from './resolve-selected-city.usecase.js';

/** O panorama da base inteira, para o resumo da tela principal. */
export const BASE_ANALYTICS_CACHE_KEY: CacheKey = {
  namespace: CacheNamespace.COMPANY_ANALYTICS,
  identifier: 'base',
};

const BASE_ANALYTICS_TTL_SECONDS = 3_600;

/**
 * Panorama do conjunto de empresas (UC19, RF37): os critérios são os da pesquisa, e sem nenhum
 * critério vale a base inteira. Lê só o que já está guardado, sem chamar fonte nem publicar job.
 *
 * Sem critérios, a resposta fica em cache por uma hora: a tela principal a pede a cada entrada.
 *
 * @throws {OdsNotAvailableException} quando o `ods` não é calculado pelo BIOS (422).
 */
@Injectable()
export class GetCompanyAnalyticsUseCase extends UseCase<
  CompanyAnalyticsQuery,
  CompanyAnalytics
> {
  constructor(
    private readonly analytics: CompanyAnalyticsRepository,
    private readonly ensureActiveOds: EnsureActiveOdsUseCase,
    private readonly selectedCity: ResolveSelectedCityUseCase,
    private readonly cache: CacheProvider,
    private readonly configService: ConfigService<Environment, true>,
  ) {
    super();
  }

  override async execute(
    query: CompanyAnalyticsQuery,
  ): Promise<CompanyAnalytics> {
    if (query.ods !== undefined) await this.ensureActiveOds.execute(query.ods);

    const input = toSearchInput(
      query,
      { skip: 0, take: 0 },
      await this.selectedCity.execute(query),
    );
    const useCache = !hasAnalyticsCriteria(input);

    if (useCache) {
      const cached = await this.cache.get<CompanyAnalytics>(
        BASE_ANALYTICS_CACHE_KEY,
      );

      if (cached) return cached;
    }

    const analytics = toCompanyAnalytics(
      await this.analytics.aggregate(input),
      this.configService.get('SECTOR_SNAPSHOT_MIN_COMPANIES', { infer: true }),
    );

    if (useCache) {
      await this.cache.set(
        BASE_ANALYTICS_CACHE_KEY,
        analytics,
        BASE_ANALYTICS_TTL_SECONDS,
      );
    }

    return analytics;
  }
}

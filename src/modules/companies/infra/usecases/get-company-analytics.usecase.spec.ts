import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { EnsureActiveOdsUseCase } from '@modules/scoring/infra/usecases/ensure-active-ods.usecase.js';
import { CacheProvider } from '@shared/domain/providers/cache.provider.js';
import type { CompanyAnalyticsRows } from '../../domain/dtos/repositories/company-analytics.repository.js';
import { CompanyAnalyticsRepository } from '../../domain/dtos/repositories/company-analytics.repository.js';
import {
  BASE_ANALYTICS_CACHE_KEY,
  GetCompanyAnalyticsUseCase,
} from './get-company-analytics.usecase.js';
import { ResolveSelectedCityUseCase } from './resolve-selected-city.usecase.js';

const ROWS: CompanyAnalyticsRows = {
  companies: 1,
  totals: {
    confirmed_evidences: 0,
    fine_notices: 0,
    fine_amount: 0,
    area_hectares: 0,
  },
  status: [],
  size: [],
  legalNature: [],
  uf: [],
  sector: [],
  biome: [],
  infractionType: [],
  sanction: [],
  year: [],
  ods: [],
};

describe('GetCompanyAnalyticsUseCase', () => {
  const selectedCity = { execute: vi.fn().mockResolvedValue(undefined) };
  const analytics = {
    aggregate: vi.fn<CompanyAnalyticsRepository['aggregate']>(),
  };
  const ensureActiveOds = { execute: vi.fn() };
  const cache = {
    get: vi.fn<CacheProvider['get']>(),
    set: vi.fn<CacheProvider['set']>(),
  };
  let useCase: GetCompanyAnalyticsUseCase;

  beforeEach(async () => {
    analytics.aggregate.mockResolvedValue(ROWS);
    cache.get.mockResolvedValue(undefined);
    cache.set.mockResolvedValue(undefined);

    const moduleRef = await Test.createTestingModule({
      providers: [
        GetCompanyAnalyticsUseCase,
        { provide: CompanyAnalyticsRepository, useValue: analytics },
        { provide: EnsureActiveOdsUseCase, useValue: ensureActiveOds },
        {
          provide: ResolveSelectedCityUseCase,
          useValue: selectedCity,
        },
        { provide: CacheProvider, useValue: cache },
        { provide: ConfigService, useValue: { get: () => 5 } },
      ],
    }).compile();

    useCase = moduleRef.get(GetCompanyAnalyticsUseCase);
  });

  it('sem critérios, responde a base inteira e guarda em cache', async () => {
    const response = await useCase.execute({});

    expect(response.minimum_sample).toBe(5);
    expect(cache.set).toHaveBeenCalledWith(
      BASE_ANALYTICS_CACHE_KEY,
      response,
      3_600,
    );
  });

  it('sem critérios, usa o cache quando ele existe', async () => {
    const cached = { companies: 99 };
    cache.get.mockResolvedValue(cached);

    await expect(useCase.execute({})).resolves.toBe(cached);

    expect(analytics.aggregate).not.toHaveBeenCalled();
  });

  it('com critérios, não lê nem grava o cache', async () => {
    await useCase.execute({ uf: 'SP' });

    expect(cache.get).not.toHaveBeenCalled();
    expect(cache.set).not.toHaveBeenCalled();
    expect(analytics.aggregate).toHaveBeenCalledWith(
      expect.objectContaining({ uf: 'SP' }),
    );
  });

  it('confere se o ODS é calculado pelo BIOS', async () => {
    await useCase.execute({ ods: 15 });

    expect(ensureActiveOds.execute).toHaveBeenCalledWith(15);
  });
});

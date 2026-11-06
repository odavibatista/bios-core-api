import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerName } from '@shared/config/throttler.config.js';
import { ROUTE_RATE_LIMIT } from '@shared/http/decorators/route-rate-limit.decorator.js';
import { CompanyAnalyticsQuerySchema } from '../../domain/dtos/requests/search-companies.dto.js';
import { GetCompanyAnalyticsUseCase } from '../../infra/usecases/get-company-analytics.usecase.js';
import { CompanyAnalyticsController } from './company-analytics.controller.js';

describe('CompanyAnalyticsController', () => {
  const analytics = { execute: vi.fn() };
  let controller: CompanyAnalyticsController;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [CompanyAnalyticsController],
      providers: [{ provide: GetCompanyAnalyticsUseCase, useValue: analytics }],
    }).compile();

    controller = moduleRef.get(CompanyAnalyticsController);
  });

  it('repassa os critérios ao caso de uso', async () => {
    const response = { companies: 1 };
    analytics.execute.mockResolvedValue(response);

    await expect(controller.getAnalytics({ uf: 'SP' })).resolves.toBe(response);
    expect(analytics.execute).toHaveBeenCalledWith({ uf: 'SP' });
  });

  it('usa o limite da pesquisa', () => {
    const handler = Object.getOwnPropertyDescriptor(
      CompanyAnalyticsController.prototype,
      'getAnalytics',
    )?.value as () => unknown;

    expect(new Reflector().get<string>(ROUTE_RATE_LIMIT, handler)).toBe(
      ThrottlerName.COMPANY_SEARCH,
    );
  });

  it('aceita a consulta sem critério, mas mantém as regras entre eles', () => {
    expect(CompanyAnalyticsQuerySchema.safeParse({}).success).toBe(true);
    expect(
      CompanyAnalyticsQuerySchema.safeParse({ min_score: 10 }).success,
    ).toBe(false);
  });
});

import { Controller, Get, HttpStatus, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ThrottlerName } from '@shared/config/throttler.config.js';
import {
  ErrorResponses,
  ResponseSchema,
} from '@shared/http/decorators/response-schema.decorator.js';
import { RouteRateLimit } from '@shared/http/decorators/route-rate-limit.decorator.js';
import {
  type CompanyAnalytics,
  CompanyAnalyticsResponseSchema,
} from '../../domain/dtos/requests/company-analytics.dto.js';
import {
  type CompanyAnalyticsQuery,
  CompanyAnalyticsQuerySchema,
} from '../../domain/dtos/requests/search-companies.dto.js';
import { GetCompanyAnalyticsUseCase } from '../../infra/usecases/get-company-analytics.usecase.js';

// Privado, como toda rota sem `@Public()`: o panorama exige sessão (RF02).
@ApiTags('Empresas')
@ApiBearerAuth('jwt')
@Controller('companies/analytics')
export class CompanyAnalyticsController {
  constructor(private readonly analytics: GetCompanyAnalyticsUseCase) {}

  @Get()
  // Soma a base a cada filtro: mesmo limite da pesquisa (NFSE04).
  @RouteRateLimit(ThrottlerName.COMPANY_SEARCH)
  @ApiOperation({
    operationId: 'getCompanyAnalytics',
    summary: 'Totais e distribuições do conjunto de empresas',
    description:
      'Aceita os critérios de `GET /companies`, sem paginação; sem critério, responde pela base inteira. Traz cadastros por situação, porte, natureza jurídica, UF e setor; evidências confirmadas por bioma, tipo de infração, sanção e ano; e, por ODS, médias e faixas de índice e de confiança, separadas. Abaixo da amostra mínima (`SECTOR_SNAPSHOT_MIN_COMPANIES`, padrão 5), médias e faixas ficam omitidas e as contagens continuam. Nenhuma empresa é citada, e nada é ordenado por índice, multa ou número de evidências. `fine_amount` é o valor lançado nos autos, e não o valor pago. Os números se referem às empresas da base, e não a todas as empresas do Brasil.',
  })
  @ResponseSchema(CompanyAnalyticsResponseSchema, {
    description: 'Panorama do conjunto de empresas',
  })
  @ErrorResponses(
    HttpStatus.UNAUTHORIZED,
    HttpStatus.UNPROCESSABLE_ENTITY,
    HttpStatus.TOO_MANY_REQUESTS,
  )
  getAnalytics(
    @Query({ schema: CompanyAnalyticsQuerySchema })
    query: CompanyAnalyticsQuery,
  ): Promise<CompanyAnalytics> {
    return this.analytics.execute(query);
  }
}

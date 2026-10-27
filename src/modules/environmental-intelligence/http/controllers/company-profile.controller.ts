import { Controller, Get, HttpStatus, Param } from '@nestjs/common';
import { ThrottlerName } from '@shared/config/throttler.config.js';
import { RouteRateLimit } from '@shared/http/decorators/route-rate-limit.decorator.js';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import {
  ErrorResponses,
  ResponseSchema,
} from '@shared/http/decorators/response-schema.decorator.js';
import type { CompanyFullProfileControllerInterface } from '../../domain/dtos/controllers/company-full-profile.controller.dto.js';
import {
  type CompanyFullProfileResponse,
  CompanyFullProfileResponseSchema,
} from '../../domain/dtos/requests/company-full-profile.dto.js';
import { GetCompanyFullProfileUseCase } from '../../infra/usecases/get-company-full-profile.usecase.js';

// Privado, como toda rota sem `@Public()`: consultar empresas exige sessão (RF02).
@ApiTags('Empresas')
@ApiBearerAuth('jwt')
@Controller('companies')
export class CompanyProfileController implements CompanyFullProfileControllerInterface {
  constructor(private readonly getFullProfile: GetCompanyFullProfileUseCase) {}

  @Get(':cnpj')
  // Consolidar as fontes pode disparar coletas externas, mas a chamada em cache é barata: limite próprio (NFSE04).
  @RouteRateLimit(ThrottlerName.COMPANY_PROFILE)
  @ApiOperation({
    operationId: 'getCompanyProfile',
    summary: 'Consulta o perfil completo de uma empresa pelo CNPJ',
    description:
      'Compõe o cadastro (cache, banco ou provedores BrasilAPI, OpenCNPJ e Minha Receita), as evidências ambientais do IBAMA, da CGU e do GHG Protocol, agrupadas por categoria e com a referência da fonte original, e, por ODS, o índice de aderência, a confiança e a explicação do score, lado a lado e nunca combinados. Cada fonte degrada por conta própria: fonte fora do ar vira evidência `UNKNOWN`, nunca nota baixa. `ods_scores[].calculation_status = PENDING` indica índice ainda não calculado. Com os provedores cadastrais indisponíveis, serve o último cadastro guardado, se houver; sem ele, responde 503. Limite próprio por IP (padrão: 60 consultas por minuto, `THROTTLE_COMPANY_PROFILE_LIMIT`), no lugar do limite global. Aceita CNPJ numérico e alfanumérico; os separadores `.` `-` são ignorados (a barra deve ser omitida, pois separa segmentos da URL).',
  })
  @ApiParam({
    name: 'cnpj',
    description: 'CNPJ da empresa, com 14 caracteres',
    example: '11222333000181',
  })
  @ResponseSchema(CompanyFullProfileResponseSchema, {
    description: 'Perfil completo da empresa',
  })
  @ErrorResponses(
    HttpStatus.UNAUTHORIZED,
    HttpStatus.NOT_FOUND,
    HttpStatus.UNPROCESSABLE_ENTITY,
    HttpStatus.TOO_MANY_REQUESTS,
    HttpStatus.SERVICE_UNAVAILABLE,
  )
  getCompanyProfile(
    @Param('cnpj') cnpj: string,
  ): Promise<CompanyFullProfileResponse> {
    return this.getFullProfile.execute(cnpj);
  }
}

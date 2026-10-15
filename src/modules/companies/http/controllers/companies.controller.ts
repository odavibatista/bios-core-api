import { Controller, Get, HttpStatus, Param } from '@nestjs/common';
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
import type { CompaniesControllerInterface } from '../../domain/dtos/controllers/companies.controller.dto.js';
import {
  type CompanyProfileResponse,
  CompanyProfileResponseSchema,
} from '../../domain/dtos/requests/company-profile.dto.js';
import { GetCompanyProfileUseCase } from '../../infra/usecases/get-company-profile.usecase.js';

// Privado, como toda rota sem `@Public()`: consultar empresas exige sessão (RF02).
@ApiTags('Empresas')
@ApiBearerAuth('jwt')
@Controller('companies')
export class CompaniesController implements CompaniesControllerInterface {
  constructor(
    private readonly getCompanyProfileUseCase: GetCompanyProfileUseCase,
  ) {}

  @Get(':cnpj')
  @ApiOperation({
    summary: 'Consulta o perfil cadastral de uma empresa pelo CNPJ',
    description:
      'Serve do cache quando há; do contrário, atualiza pela cadeia de provedores (BrasilAPI, OpenCNPJ, Minha Receita) e guarda o resultado. Com os provedores indisponíveis, serve o último cadastro guardado, se houver; sem ele, responde 503. Aceita CNPJ numérico e alfanumérico; os separadores `.` `-` são ignorados (a barra deve ser omitida, pois separa segmentos da URL).',
  })
  @ApiParam({
    name: 'cnpj',
    description: 'CNPJ da empresa, com 14 caracteres',
    example: '11222333000181',
  })
  @ResponseSchema(CompanyProfileResponseSchema, {
    description: 'Perfil cadastral da empresa',
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
  ): Promise<CompanyProfileResponse> {
    return this.getCompanyProfileUseCase.execute(cnpj);
  }
}

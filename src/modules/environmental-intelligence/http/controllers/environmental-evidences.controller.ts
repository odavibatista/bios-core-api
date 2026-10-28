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
import type { EnvironmentalEvidencesControllerInterface } from '../../domain/dtos/controllers/environmental-evidences.controller.dto.js';
import {
  CompanyEnvironmentalEvidencesRequestSchema,
  CompanyEnvironmentalEvidencesResponseSchema,
  type CompanyEnvironmentalEvidencesRequest,
  type CompanyEnvironmentalEvidencesResponse,
} from '@modules/evidences/domain/dtos/requests/company-evidences.dto.js';
import { GetCompanyEnvironmentalEvidencesUseCase } from '../../infra/usecases/get-company-environmental-evidences.usecase.js';

/** Rota privada por padrão: expõe proveniência sem compor score ou perfil completo. */
@ApiTags('Evidências')
@ApiBearerAuth('jwt')
@Controller('companies')
export class EnvironmentalEvidencesController implements EnvironmentalEvidencesControllerInterface {
  constructor(
    private readonly getEvidences: GetCompanyEnvironmentalEvidencesUseCase,
  ) {}

  @Get(':cnpj/evidences')
  @RouteRateLimit(ThrottlerName.COMPANY_EVIDENCES)
  @ApiOperation({
    operationId: 'getCompanyEvidences',
    summary: 'Consulta evidências e referências às fontes originais',
    description:
      'Exige perfil cadastral local; sem ele, responde 404 sem iniciar coletas. Limite próprio por IP (padrão: 20 consultas por minuto, `THROTTLE_COMPANY_EVIDENCES_LIMIT`, NFSE04), no lugar do limite global. Reúne IBAMA local, CGU e GHG com degradação independente e agrupa por categoria. Mostra o mesmo retrato do perfil completo (GET /companies/{cnpj}): com as evidências em cache (até 5 minutos, apagadas quando o índice da empresa é recalculado), responde sem coletar nem recalcular. source é o nome público do catálogo. source_reference identifica o registro; source_url é um link HTTPS original, inclusive para o recurso oficial quando não existe link individual. O acesso ao recurso CGU pode exigir credencial do próprio órgão. Sem referência ou link rastreável, uma evidência guardada como CONFIRMED é apresentada como UNKNOWN, sem sinal, resumo ou detalhes confirmatórios. Não inventa links, não altera o histórico e não calcula score. UNKNOWN e NOT_FOUND podem ter referências nulas. Aceita CNPJ numérico ou alfanumérico; omita a barra de formatação na URL.',
  })
  @ApiParam({
    name: 'cnpj',
    description: 'CNPJ válido da empresa',
    example: '11222333000181',
  })
  @ResponseSchema(CompanyEnvironmentalEvidencesResponseSchema, {
    description: 'Evidências agrupadas com fonte e proveniência auditável',
  })
  @ErrorResponses(
    HttpStatus.UNAUTHORIZED,
    HttpStatus.NOT_FOUND,
    HttpStatus.UNPROCESSABLE_ENTITY,
    HttpStatus.TOO_MANY_REQUESTS,
    HttpStatus.SERVICE_UNAVAILABLE,
    HttpStatus.INTERNAL_SERVER_ERROR,
  )
  getCompanyEvidences(
    @Param({ schema: CompanyEnvironmentalEvidencesRequestSchema })
    params: CompanyEnvironmentalEvidencesRequest,
  ): Promise<CompanyEnvironmentalEvidencesResponse> {
    return this.getEvidences.execute(params.cnpj);
  }
}

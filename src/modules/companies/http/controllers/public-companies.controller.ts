import { Controller, Get, HttpStatus, Param } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { ApiKeyAuth } from '@modules/api-keys/http/decorators/api-key-auth.decorator.js';
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

/**
 * Perfil de empresa para sistemas de terceiros (UC12, RF17).
 *
 * Executa a mesma consulta do painel (`GET /companies/:cnpj`), mas se
 * autentica pela chave de API do integrador (UC11) em vez de uma sessão, e é
 * limitada por chave (NFSE04). O prefixo `v1` existe para que o contrato
 * público possa evoluir sem quebrar quem já integrou.
 */
@ApiTags('API pública')
@ApiKeyAuth()
@Controller('v1/companies')
export class PublicCompaniesController implements CompaniesControllerInterface {
  constructor(
    private readonly getCompanyProfileUseCase: GetCompanyProfileUseCase,
  ) {}

  @Get(':cnpj')
  @ApiOperation({
    summary:
      'Consulta o perfil cadastral de uma empresa pelo CNPJ (API pública)',
    description:
      'Autentica pela chave de API no cabeçalho `x-api-key` (gerada no painel, UC11). O limite de requisições é por chave: excedido, responde 429 com `Retry-After`. O perfil devolvido é o mesmo da consulta do painel; as evidências e os índices por ODS acompanharão a resposta quando o perfil ambiental estiver disponível.',
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

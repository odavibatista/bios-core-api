import { Controller, Get, HttpStatus, Param } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { ApiKeyAuth } from '@modules/api-keys/http/decorators/api-key-auth.decorator.js';
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

/**
 * Perfil completo de empresa para sistemas de terceiros (UC12, RF17).
 *
 * Executa a mesma consulta do painel (`GET /companies/:cnpj`), mas se
 * autentica pela chave de API do integrador (UC11) em vez de uma sessão, e é
 * limitada por chave (NFSE04). O prefixo `v1` existe para que o contrato
 * público possa evoluir sem quebrar quem já integrou.
 */
@ApiTags('API pública')
@ApiKeyAuth()
@Controller('v1/companies')
export class PublicCompanyProfileController implements CompanyFullProfileControllerInterface {
  constructor(private readonly getFullProfile: GetCompanyFullProfileUseCase) {}

  @Get(':cnpj')
  @ApiOperation({
    summary:
      'Consulta o perfil completo de uma empresa pelo CNPJ (API pública)',
    description:
      'Autentica pela chave de API no cabeçalho `x-api-key` (gerada no painel, UC11). O limite de requisições é por chave: excedido, responde 429 com `Retry-After`. Devolve o mesmo perfil do painel: cadastro, evidências ambientais agrupadas por categoria (com a referência da fonte original) e, por ODS, índice, confiança e explicação. O índice não é um veredito de sustentabilidade e os ODS não são combinados em índice geral.',
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

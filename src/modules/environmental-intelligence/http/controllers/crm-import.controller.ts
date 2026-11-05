import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiKeyAuth } from '@modules/api-keys/http/decorators/api-key-auth.decorator.js';
import { ThrottlerName } from '@shared/config/throttler.config.js';
import {
  ErrorResponses,
  ResponseSchema,
} from '@shared/http/decorators/response-schema.decorator.js';
import { RouteRateLimit } from '@shared/http/decorators/route-rate-limit.decorator.js';
import {
  type CrmImportRequest,
  CrmImportRequestSchema,
  type CrmImportResponse,
  CrmImportResponseSchema,
} from '../../domain/dtos/requests/crm-import.dto.js';
import { ImportCrmAccountsUseCase } from '../../infra/usecases/import-crm-accounts.usecase.js';

/** Importação de contas por CRMs de terceiros (UC16, RF31), autenticada por chave de API. */
@ApiTags('API pública')
@ApiKeyAuth()
@Controller('v1/crm')
export class CrmImportController {
  constructor(private readonly importAccounts: ImportCrmAccountsUseCase) {}

  @Post('companies')
  @HttpCode(HttpStatus.OK)
  // Uma chamada vale até 20 consultas: limite próprio, para o lote não multiplicar o da API pública.
  @RouteRateLimit(ThrottlerName.CRM_IMPORT)
  @ApiOperation({
    operationId: 'importCrmCompanies',
    summary: 'Importa em lote o perfil ambiental das contas de um CRM',
    description:
      'Recebe até 20 CNPJs e devolve, na ordem enviada, o estado de cada um (`IMPORTED`, `NOT_FOUND`, `INVALID` ou `UNAVAILABLE`) e a conta em campos planos: dados cadastrais, índice e confiança por ODS e contagem de evidências confirmadas por categoria. Como em `GET /v1/companies/:cnpj`, não espera as fontes externas: o que estiver pendente vem em `scores_pending` e `retry_after_seconds`. Não leva contato, logradouro, número, complemento nem CEP. A razão social de empresário individual pode conter o nome do titular, com o CPF mascarado. O índice não é um veredito de sustentabilidade nem deve fundamentar decisão automática sobre uma pessoa. Limite próprio por IP (padrão: 3 lotes por minuto, `THROTTLE_CRM_IMPORT_LIMIT`), somado ao limite por chave.',
  })
  @ResponseSchema(CrmImportResponseSchema, {
    description: 'Contas do lote, com o estado de cada CNPJ',
  })
  @ErrorResponses(
    HttpStatus.UNAUTHORIZED,
    HttpStatus.UNPROCESSABLE_ENTITY,
    HttpStatus.TOO_MANY_REQUESTS,
  )
  importCompanies(
    @Body({ schema: CrmImportRequestSchema }) body: CrmImportRequest,
  ): Promise<CrmImportResponse> {
    return this.importAccounts.execute(body);
  }
}

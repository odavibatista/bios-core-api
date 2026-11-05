import { Controller, Get, HttpStatus, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ErrorResponses,
  ResponseSchema,
} from '@shared/http/decorators/response-schema.decorator.js';
import type { CompanyMovementsControllerInterface } from '../../domain/dtos/controllers/companies.controller.dto.js';
import {
  type CompanyMovementsQuery,
  CompanyMovementsQuerySchema,
  type CompanyMovementsResponse,
  CompanyMovementsResponseSchema,
} from '../../domain/dtos/requests/company-movements.dto.js';
import { ListRecentCompanyMovementsUseCase } from '../../infra/usecases/list-recent-company-movements.usecase.js';

// Privado, como toda rota sem `@Public()`: a tela principal exige sessão (`[P14]`). Sem
// `@ApiKeyAuth()`, chave de API não entra.
@ApiTags('Empresas')
@ApiBearerAuth('jwt')
@Controller('companies/movements')
export class CompanyMovementsController implements CompanyMovementsControllerInterface {
  constructor(
    private readonly listRecentMovements: ListRecentCompanyMovementsUseCase,
  ) {}

  @Get()
  @ApiOperation({
    operationId: 'listCompanyMovements',
    summary: 'Lista as empresas com movimentação recente do índice',
    description:
      'A lista da tela principal (UC18): empresas com perfil e movimentação registrada, da mais recente para a mais antiga, com o CNPJ como desempate. O parâmetro opcional category restringe a empresas com movimentação da categoria indicada e exibe somente esse conjunto na página. Cada empresa aparece uma vez e traz, para cada ODS ativo, o índice e a confiança atuais e a última movimentação, com sentido, causa e data. Não traz índice anterior, variação nem histórico por empresa (IND03), e a ordem é só cronológica. Lê apenas o que já foi gravado, sem consultar fontes externas nem recalcular. Sem movimentações, responde 200 com a lista vazia.',
  })
  @ResponseSchema(CompanyMovementsResponseSchema, {
    description: 'Página de empresas com movimentação recente',
  })
  @ErrorResponses(
    HttpStatus.UNAUTHORIZED,
    HttpStatus.UNPROCESSABLE_ENTITY,
    HttpStatus.TOO_MANY_REQUESTS,
  )
  listCompanyMovements(
    @Query({ schema: CompanyMovementsQuerySchema })
    query: CompanyMovementsQuery,
  ): Promise<CompanyMovementsResponse> {
    return this.listRecentMovements.execute(query);
  }
}

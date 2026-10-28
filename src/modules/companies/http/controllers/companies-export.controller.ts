import {
  Controller,
  Get,
  HttpStatus,
  Query,
  StreamableFile,
} from '@nestjs/common';
import { ThrottlerName } from '@shared/config/throttler.config.js';
import { RouteRateLimit } from '@shared/http/decorators/route-rate-limit.decorator.js';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ErrorResponses } from '@shared/http/decorators/response-schema.decorator.js';
import type { CompaniesExportControllerInterface } from '../../domain/dtos/controllers/companies.controller.dto.js';
import {
  type ExportCompaniesQuery,
  ExportCompaniesQuerySchema,
} from '../../domain/dtos/requests/search-companies.dto.js';
import {
  ExportCompaniesUseCase,
  XLSX_CONTENT_TYPE,
} from '../../infra/usecases/export-companies.usecase.js';

// Privado, como toda rota sem `@Public()`: exportar a lista exige sessão (RF02).
@ApiTags('Empresas')
@ApiBearerAuth('jwt')
@Controller('companies/export')
export class CompaniesExportController implements CompaniesExportControllerInterface {
  constructor(
    private readonly exportCompaniesUseCase: ExportCompaniesUseCase,
  ) {}

  @Get('xlsx')
  // Gera um arquivo a cada chamada: limite próprio, menor que os da pesquisa e do perfil (NFSE04).
  @RouteRateLimit(ThrottlerName.COMPANY_EXPORT)
  @ApiOperation({
    operationId: 'exportCompaniesXlsx',
    summary: 'Exporta em XLSX a lista da pesquisa de empresas',
    description:
      'Aceita os mesmos critérios e a mesma ordenação de `GET /companies` (`name`, `uf`, `city`, `cnae`, `ods`, `min_score`, `min_confidence`, `order`), sem paginação: o arquivo traz a lista inteira, na ordem da pesquisa. Uma linha por empresa, com os dados cadastrais (CNPJ, razão social, nome fantasia, situação cadastral, UF, município e CNAE principal) e, em colunas separadas para cada ODS ativo, o índice e a confiança, vazios quando não calculados. Não leva dado pessoal nem de contato de indivíduo. Sem empresa que atenda aos critérios, responde 404 `NO_RESULTS_TO_EXPORT`; acima do teto de empresas (padrão 5000, `EXPORT_MAX_COMPANIES`), 422 `EXPORT_TOO_LARGE` com `details.total` e `details.max`. Limite próprio por IP (padrão: 10 exportações por minuto, `THROTTLE_COMPANY_EXPORT_LIMIT`), no lugar do limite global.',
  })
  @ApiResponse({
    status: HttpStatus.OK,
    description: 'Planilha XLSX com a lista de empresas',
    content: {
      [XLSX_CONTENT_TYPE]: { schema: { type: 'string', format: 'binary' } },
    },
  })
  @ErrorResponses(
    HttpStatus.UNAUTHORIZED,
    HttpStatus.NOT_FOUND,
    HttpStatus.UNPROCESSABLE_ENTITY,
    HttpStatus.TOO_MANY_REQUESTS,
  )
  async exportCompanies(
    @Query({ schema: ExportCompaniesQuerySchema }) query: ExportCompaniesQuery,
  ): Promise<StreamableFile> {
    const { content, fileName } =
      await this.exportCompaniesUseCase.execute(query);

    return new StreamableFile(content, {
      type: XLSX_CONTENT_TYPE,
      disposition: `attachment; filename="${fileName}"`,
      length: content.length,
    });
  }
}

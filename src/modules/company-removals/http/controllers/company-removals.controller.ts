import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { UserRole } from '@prisma/client';
import {
  ErrorResponses,
  ResponseSchema,
} from '@shared/http/decorators/response-schema.decorator.js';
import { Roles } from '@shared/http/decorators/roles.decorator.js';
import {
  type AddCompanyRemovalRequest,
  AddCompanyRemovalRequestSchema,
  type CompanyRemoval,
  type CompanyRemovalListResponse,
  CompanyRemovalListResponseSchema,
  CompanyRemovalSchema,
  type ListCompanyRemovalsQuery,
  ListCompanyRemovalsQuerySchema,
} from '../../domain/dtos/requests/company-removal.dto.js';
import { ListCompanyRemovalsUseCase } from '../../infra/usecases/list-company-removals.usecase.js';
import { RemoveCompanyUseCase } from '../../infra/usecases/remove-company.usecase.js';
import { RestoreCompanyUseCase } from '../../infra/usecases/restore-company.usecase.js';

/** Retirada de cadastros a pedido do titular, exclusiva de `ADMIN`. */
@ApiTags('Administração')
@ApiBearerAuth('jwt')
@Roles(UserRole.ADMIN)
@Controller('admin/company-removals')
export class CompanyRemovalsController {
  constructor(
    private readonly listUseCase: ListCompanyRemovalsUseCase,
    private readonly removeUseCase: RemoveCompanyUseCase,
    private readonly restoreUseCase: RestoreCompanyUseCase,
  ) {}

  @Get()
  @ApiOperation({
    operationId: 'listCompanyRemovals',
    summary: 'Lista os cadastros retirados',
    description:
      'Exclusivo de administrador. Traz o CNPJ e a data de cada retirada, da mais recente para a mais antiga.',
  })
  @ResponseSchema(CompanyRemovalListResponseSchema, {
    description: 'Página de cadastros retirados',
  })
  @ErrorResponses(
    HttpStatus.UNAUTHORIZED,
    HttpStatus.FORBIDDEN,
    HttpStatus.UNPROCESSABLE_ENTITY,
    HttpStatus.TOO_MANY_REQUESTS,
  )
  list(
    @Query({ schema: ListCompanyRemovalsQuerySchema })
    query: ListCompanyRemovalsQuery,
  ): Promise<CompanyRemovalListResponse> {
    return this.listUseCase.execute(query);
  }

  @Post()
  @ApiOperation({
    operationId: 'addCompanyRemoval',
    summary: 'Retira um cadastro a pedido do titular',
    description:
      'Exclusivo de administrador, depois de conferir a titularidade do pedido. Apaga cadastro, evidências, índices e movimentações do CNPJ e o mantém na lista, para que nenhuma coleta o traga de volta. As médias de setor não mudam. Repetir o pedido apaga de novo, sem erro.',
  })
  @ResponseSchema(CompanyRemovalSchema, {
    status: HttpStatus.CREATED,
    description: 'Cadastro retirado',
  })
  @ErrorResponses(
    HttpStatus.UNAUTHORIZED,
    HttpStatus.FORBIDDEN,
    HttpStatus.UNPROCESSABLE_ENTITY,
    HttpStatus.TOO_MANY_REQUESTS,
  )
  add(
    @Body({ schema: AddCompanyRemovalRequestSchema })
    body: AddCompanyRemovalRequest,
  ): Promise<CompanyRemoval> {
    return this.removeUseCase.execute(body.cnpj);
  }

  @Delete(':cnpj')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    operationId: 'restoreCompany',
    summary: 'Tira um CNPJ da lista de retirados',
    description:
      'Exclusivo de administrador. O cadastro volta na próxima consulta, coletado de novo nas fontes.',
  })
  @ApiParam({ name: 'cnpj', description: 'CNPJ, com 14 caracteres' })
  @ApiResponse({
    status: HttpStatus.NO_CONTENT,
    description: 'CNPJ fora da lista',
  })
  @ErrorResponses(
    HttpStatus.UNAUTHORIZED,
    HttpStatus.FORBIDDEN,
    HttpStatus.NOT_FOUND,
    HttpStatus.UNPROCESSABLE_ENTITY,
    HttpStatus.TOO_MANY_REQUESTS,
  )
  async restore(@Param('cnpj') cnpj: string): Promise<void> {
    await this.restoreUseCase.execute(cnpj);
  }
}

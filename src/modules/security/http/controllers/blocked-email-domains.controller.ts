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
import type { AuthenticatedUser } from '@shared/domain/dtos/authenticated-user.dto.js';
import { CurrentUser } from '@shared/http/decorators/current-user.decorator.js';
import {
  ErrorResponses,
  ResponseSchema,
} from '@shared/http/decorators/response-schema.decorator.js';
import { Roles } from '@shared/http/decorators/roles.decorator.js';
import type { BlockedEmailDomainsControllerInterface } from '../../domain/dtos/controllers/blocked-email-domains.controller.dto.js';
import {
  type AddBlockedEmailDomainRequest,
  AddBlockedEmailDomainRequestSchema,
  type BlockedEmailDomain,
  type BlockedEmailDomainListResponse,
  BlockedEmailDomainListResponseSchema,
  BlockedEmailDomainSchema,
  type ListBlockedEmailDomainsQuery,
  ListBlockedEmailDomainsQuerySchema,
} from '../../domain/dtos/requests/blocked-email-domain.dto.js';
import { AddBlockedEmailDomainUseCase } from '../../infra/usecases/add-blocked-email-domain.usecase.js';
import { ListBlockedEmailDomainsUseCase } from '../../infra/usecases/list-blocked-email-domains.usecase.js';
import { RemoveBlockedEmailDomainUseCase } from '../../infra/usecases/remove-blocked-email-domain.usecase.js';

/**
 * Manutenção da blacklist de domínios de e-mail pelo administrador (UC13, RF29, `[P12]`).
 *
 * Exclusiva de `ADMIN`: sem sessão, `401`; com sessão de `USER`, `403`. Chave de API não
 * autentica aqui (11-Permissões). As alterações valem no cadastro seguinte, sem novo deploy.
 */
@ApiTags('Administração')
@ApiBearerAuth('jwt')
@Roles(UserRole.ADMIN)
@Controller('admin/blocked-email-domains')
export class BlockedEmailDomainsController implements BlockedEmailDomainsControllerInterface {
  constructor(
    private readonly listUseCase: ListBlockedEmailDomainsUseCase,
    private readonly addUseCase: AddBlockedEmailDomainUseCase,
    private readonly removeUseCase: RemoveBlockedEmailDomainUseCase,
  ) {}

  @Get()
  @ApiOperation({
    operationId: 'listBlockedEmailDomains',
    summary: 'Lista os domínios de e-mail bloqueados',
    description:
      'Exclusivo de administrador. Traz os domínios bloqueados agora, em ordem alfabética e paginados; os removidos não aparecem. A origem diz se o domínio veio da carga inicial (SEED) ou de um administrador (ADMIN).',
  })
  @ResponseSchema(BlockedEmailDomainListResponseSchema, {
    description: 'Página de domínios bloqueados',
  })
  @ErrorResponses(
    HttpStatus.UNAUTHORIZED,
    HttpStatus.FORBIDDEN,
    HttpStatus.UNPROCESSABLE_ENTITY,
    HttpStatus.TOO_MANY_REQUESTS,
  )
  list(
    @Query({ schema: ListBlockedEmailDomainsQuerySchema })
    query: ListBlockedEmailDomainsQuery,
  ): Promise<BlockedEmailDomainListResponse> {
    return this.listUseCase.execute(query);
  }

  @Post()
  @ApiOperation({
    operationId: 'addBlockedEmailDomain',
    summary: 'Bloqueia um domínio de e-mail',
    description:
      'Exclusivo de administrador. O domínio é validado e gravado em minúsculas, sem @, e passa a valer no cadastro e na troca de e-mail seguintes, sem novo deploy. Um domínio removido antes é restaurado (não duplicado). Contas que já existem não são afetadas. Domínio já bloqueado responde 409.',
  })
  @ResponseSchema(BlockedEmailDomainSchema, {
    status: HttpStatus.CREATED,
    description: 'Domínio bloqueado',
  })
  @ErrorResponses(
    HttpStatus.UNAUTHORIZED,
    HttpStatus.FORBIDDEN,
    HttpStatus.CONFLICT,
    HttpStatus.UNPROCESSABLE_ENTITY,
    HttpStatus.TOO_MANY_REQUESTS,
  )
  add(
    @Body({ schema: AddBlockedEmailDomainRequestSchema })
    body: AddBlockedEmailDomainRequest,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<BlockedEmailDomain> {
    return this.addUseCase.execute({ user, request: body });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    operationId: 'removeBlockedEmailDomain',
    summary: 'Remove um domínio da blacklist',
    description:
      'Exclusivo de administrador. Remoção lógica, com efeito imediato: o domínio volta a ser aceito no cadastro seguinte. Identificador inexistente ou de domínio já removido responde 404.',
  })
  @ApiParam({ name: 'id', description: 'Identificador do domínio bloqueado' })
  @ApiResponse({
    status: HttpStatus.NO_CONTENT,
    description: 'Domínio removido',
  })
  @ErrorResponses(
    HttpStatus.UNAUTHORIZED,
    HttpStatus.FORBIDDEN,
    HttpStatus.NOT_FOUND,
    HttpStatus.TOO_MANY_REQUESTS,
  )
  async remove(@Param('id') id: string): Promise<void> {
    await this.removeUseCase.execute(id);
  }
}

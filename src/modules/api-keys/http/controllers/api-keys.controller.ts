import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { AuthenticatedUser } from '@shared/domain/dtos/authenticated-user.dto.js';
import { CurrentUser } from '@shared/http/decorators/current-user.decorator.js';
import {
  ErrorResponses,
  ResponseSchema,
} from '@shared/http/decorators/response-schema.decorator.js';
import type { ApiKeysControllerInterface } from '../../domain/dtos/controllers/api-keys.controller.dto.js';
import {
  type ApiKeyListResponse,
  ApiKeyListResponseSchema,
  type CreateApiKeyRequest,
  CreateApiKeyRequestSchema,
  type CreatedApiKeyResponse,
  CreatedApiKeyResponseSchema,
} from '../../domain/dtos/requests/api-key.dto.js';
import { CreateApiKeyUseCase } from '../../infra/usecases/create-api-key.usecase.js';
import { ListApiKeysUseCase } from '../../infra/usecases/list-api-keys.usecase.js';
import { RevokeApiKeyUseCase } from '../../infra/usecases/revoke-api-key.usecase.js';

// Privado, como toda rota sem `@Public()`: o usuário gerencia as próprias chaves
// autenticado por sessão (P09). A chave de API autentica a API pública, não este painel.
@ApiTags('Chaves de API')
@ApiBearerAuth('jwt')
@Controller('api-keys')
export class ApiKeysController implements ApiKeysControllerInterface {
  constructor(
    private readonly createApiKeyUseCase: CreateApiKeyUseCase,
    private readonly listApiKeysUseCase: ListApiKeysUseCase,
    private readonly revokeApiKeyUseCase: RevokeApiKeyUseCase,
  ) {}

  @Post()
  @ApiOperation({
    summary: 'Gera uma chave de API',
    description:
      'O valor completo da chave aparece **somente nesta resposta**: guarde-o agora. O sistema guarda apenas o resumo (hash) e não consegue exibir a chave de novo; se perdê-la, revogue e gere outra.',
  })
  @ResponseSchema(CreatedApiKeyResponseSchema, {
    status: HttpStatus.CREATED,
    description: 'Chave gerada',
  })
  @ErrorResponses(
    HttpStatus.UNAUTHORIZED,
    HttpStatus.UNPROCESSABLE_ENTITY,
    HttpStatus.TOO_MANY_REQUESTS,
  )
  create(
    @Body({ schema: CreateApiKeyRequestSchema }) body: CreateApiKeyRequest,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CreatedApiKeyResponse> {
    return this.createApiKeyUseCase.execute({ user, request: body });
  }

  @Get()
  @ApiOperation({
    summary: 'Lista as chaves de API ativas do usuário',
    description:
      'Traz nome, prefixo, data de criação e data do último uso. O valor da chave não é reexibido. Chaves revogadas não aparecem.',
  })
  @ResponseSchema(ApiKeyListResponseSchema, { description: 'Chaves ativas' })
  @ErrorResponses(HttpStatus.UNAUTHORIZED, HttpStatus.TOO_MANY_REQUESTS)
  list(@CurrentUser() user: AuthenticatedUser): Promise<ApiKeyListResponse> {
    return this.listApiKeysUseCase.execute(user.userId);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Revoga uma chave de API',
    description:
      'A chave é invalidada imediatamente: toda chamada com ela passa a ser recusada. Identificador inexistente, já revogado ou de outro usuário responde igual (404).',
  })
  @ApiParam({ name: 'id', description: 'Identificador da chave' })
  @ApiResponse({ status: HttpStatus.NO_CONTENT, description: 'Chave revogada' })
  @ErrorResponses(
    HttpStatus.UNAUTHORIZED,
    HttpStatus.NOT_FOUND,
    HttpStatus.TOO_MANY_REQUESTS,
  )
  async revoke(
    @Param('id') apiKeyId: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.revokeApiKeyUseCase.execute({ user, apiKeyId });
  }
}

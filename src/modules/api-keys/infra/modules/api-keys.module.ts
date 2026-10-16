import { Module } from '@nestjs/common';
import { ApiKeyRepository } from '../../domain/dtos/repositories/api-key.repository.js';
import { ApiKeysController } from '../../http/controllers/api-keys.controller.js';
import { ApiKeyGuard } from '../../http/guards/api-key.guard.js';
import { PrismaApiKeyRepository } from '../db/repositories/prisma-api-key.repository.js';
import { AuthenticateApiKeyUseCase } from '../usecases/authenticate-api-key.usecase.js';
import { CreateApiKeyUseCase } from '../usecases/create-api-key.usecase.js';
import { ListApiKeysUseCase } from '../usecases/list-api-keys.usecase.js';
import { RevokeApiKeyUseCase } from '../usecases/revoke-api-key.usecase.js';

/**
 * Chaves de API: geração, listagem e revogação pelo titular (UC11) e
 * autenticação das chamadas à API pública (UC12).
 *
 * Entidades (schemas Prisma em `../../entity`): `ApiKey`.
 *
 * Quem expõe endpoints da API pública importa este módulo e declara
 * `@ApiKeyAuth()`: o guard da chave e o caso de uso que ele consulta vêm
 * daqui.
 */
@Module({
  controllers: [ApiKeysController],
  providers: [
    /* Repositórios */
    { provide: ApiKeyRepository, useClass: PrismaApiKeyRepository },

    /* Casos de uso */
    CreateApiKeyUseCase,
    ListApiKeysUseCase,
    RevokeApiKeyUseCase,
    AuthenticateApiKeyUseCase,

    /* Guards */
    ApiKeyGuard,
  ],
  exports: [AuthenticateApiKeyUseCase, ApiKeyGuard],
})
export class ApiKeysModule {}

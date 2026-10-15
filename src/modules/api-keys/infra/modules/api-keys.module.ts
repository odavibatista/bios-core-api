import { Module } from '@nestjs/common';
import { ApiKeyRepository } from '../../domain/dtos/repositories/api-key.repository.js';
import { ApiKeysController } from '../../http/controllers/api-keys.controller.js';
import { PrismaApiKeyRepository } from '../db/repositories/prisma-api-key.repository.js';
import { CreateApiKeyUseCase } from '../usecases/create-api-key.usecase.js';
import { ListApiKeysUseCase } from '../usecases/list-api-keys.usecase.js';
import { RevokeApiKeyUseCase } from '../usecases/revoke-api-key.usecase.js';

/**
 * Chaves de API: geração, listagem e revogação pelo titular, e autenticação
 * das chamadas à API pública (UC11, UC12).
 *
 * Entidades (schemas Prisma em `../../entity`): `ApiKey`.
 *
 * Esta entrega cobre o painel do titular (UC11). A autenticação das chamadas
 * por chave (UC12) é o passo seguinte.
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
  ],
})
export class ApiKeysModule {}

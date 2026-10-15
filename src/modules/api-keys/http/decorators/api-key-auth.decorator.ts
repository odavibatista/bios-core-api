import { applyDecorators, UseGuards } from '@nestjs/common';
import { ApiSecurity } from '@nestjs/swagger';
import { PublicApiRoute } from '@shared/http/decorators/public-api-route.decorator.js';
import { Public } from '@shared/http/decorators/public.decorator.js';
import { ApiKeyGuard } from '../guards/api-key.guard.js';

/**
 * Declara o endpoint (ou o controller) como API pública autenticada por chave
 * de API (UC12, RF17).
 *
 * Reúne o que precisa andar junto:
 *  - `@Public()`: dispensa a sessão (JWT) do guard global;
 *  - `ApiKeyGuard`: exige e confere o cabeçalho `x-api-key`;
 *  - `@PublicApiRoute()`: faz valer o limite de requisições por chave;
 *  - `@ApiSecurity('api-key')`: documenta o esquema no OpenAPI.
 *
 * O módulo que usa o decorator importa `ApiKeysModule`, de onde vem o caso de
 * uso que o guard consulta.
 */
export const ApiKeyAuth = (): MethodDecorator & ClassDecorator =>
  applyDecorators(
    Public(),
    PublicApiRoute(),
    UseGuards(ApiKeyGuard),
    ApiSecurity('api-key'),
  );

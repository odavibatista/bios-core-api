import { applyDecorators, SetMetadata, UseInterceptors } from '@nestjs/common';
import { ApiExcludeEndpoint } from '@nestjs/swagger';
import { Public } from '@shared/http/decorators/public.decorator.js';
import { HoneypotInterceptor } from '../interceptors/honeypot.interceptor.js';

/** Chave do metadado que marca uma rota como isca. */
export const IS_HONEYPOT_ROUTE = 'bios:is-honeypot-route';

/**
 * Transforma o endpoint em isca (RF21, NFSE07): quem o chama tem o acesso registrado e o
 * IP bloqueado sem prazo, em qualquer rota.
 *
 * A rota fica pública (robôs não têm sessão) e fora do OpenAPI e da documentação: usuários
 * legítimos não têm como chegar a ela. **Nunca em rota real.**
 */
export const Honeypot = (): MethodDecorator =>
  applyDecorators(
    SetMetadata(IS_HONEYPOT_ROUTE, true),
    Public(),
    ApiExcludeEndpoint(),
    UseInterceptors(HoneypotInterceptor),
  );

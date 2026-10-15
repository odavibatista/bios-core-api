import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AuthenticatedUser } from '../../domain/dtos/authenticated-user.dto.js';

/** Propriedade da requisição em que o guard registra o usuário autenticado. */
export const AUTHENTICATED_USER_KEY = 'user';

/**
 * Entrega ao handler o usuário autenticado da requisição.
 *
 * Só tem valor em rotas protegidas: o guard de autenticação o estabelece antes
 * de o handler rodar. Numa rota `@Public()` o valor é `undefined`.
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser =>
    context.switchToHttp().getRequest<Record<string, AuthenticatedUser>>()[
      AUTHENTICATED_USER_KEY
    ],
);

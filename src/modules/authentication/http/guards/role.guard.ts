import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { UserRole } from '@prisma/client';
import type { AuthenticatedUser } from '@shared/domain/dtos/authenticated-user.dto.js';
import { AUTHENTICATED_USER_KEY } from '@shared/http/decorators/current-user.decorator.js';
import { REQUIRED_ROLES } from '@shared/http/decorators/roles.decorator.js';
import { InsufficientRoleException } from '../../domain/dtos/errors/insufficient-role.exception.js';
import { NotAuthenticatedException } from '../../domain/dtos/errors/not-authenticated.exception.js';

/**
 * Guard global de papel (11-Permissões): aplica o `@Roles()` da rota.
 *
 * Roda depois do guard de autenticação (registrado logo após ele) e confia no usuário que
 * aquele estabeleceu: o papel vem do access token, emitido no login e conferido contra a
 * sessão. A promoção a `ADMIN` encerra as sessões da conta (`account:promote`), então um
 * token não carrega papel antigo.
 *
 * Fecha por padrão: rota com `@Roles()` sem usuário autenticado (ex.: marcada também como
 * `@Public()`) responde `401`, nunca libera.
 */
@Injectable()
export class RoleGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<UserRole[] | undefined>(
      REQUIRED_ROLES,
      [context.getHandler(), context.getClass()],
    );

    if (!roles || roles.length === 0) return true;

    const user = context
      .switchToHttp()
      .getRequest<{ [AUTHENTICATED_USER_KEY]?: AuthenticatedUser }>()[
      AUTHENTICATED_USER_KEY
    ];

    if (!user) throw new NotAuthenticatedException();
    if (!roles.includes(user.role)) throw new InsufficientRoleException();

    return true;
  }
}

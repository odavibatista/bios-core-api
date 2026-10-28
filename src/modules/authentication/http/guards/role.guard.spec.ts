import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import type { AuthenticatedUser } from '@shared/domain/dtos/authenticated-user.dto.js';
import { AUTHENTICATED_USER_KEY } from '@shared/http/decorators/current-user.decorator.js';
import {
  REQUIRED_ROLES,
  Roles,
} from '@shared/http/decorators/roles.decorator.js';
import { faker } from '@test/support/faker.js';
import { InsufficientRoleException } from '../../domain/dtos/errors/insufficient-role.exception.js';
import { NotAuthenticatedException } from '../../domain/dtos/errors/not-authenticated.exception.js';
import { RoleGuard } from './role.guard.js';

/** Contexto de uma requisição a `handler` de `controller`, com o usuário autenticado. */
function contextOf(
  controller: abstract new (...args: never[]) => unknown,
  handler: (...args: never[]) => unknown,
  user?: AuthenticatedUser,
): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => controller,
    switchToHttp: () => ({
      getRequest: () => ({ [AUTHENTICATED_USER_KEY]: user }),
    }),
  } as unknown as ExecutionContext;
}

function userWith(role: UserRole): AuthenticatedUser {
  return {
    userId: faker.database.mongodbObjectId(),
    sessionId: faker.database.mongodbObjectId(),
    familyId: faker.database.mongodbObjectId(),
    role,
  };
}

class OpenController {
  open(): void {}
}

@Roles(UserRole.ADMIN)
class AdminController {
  admin(): void {}

  @Roles(UserRole.USER, UserRole.ADMIN)
  shared(): void {}
}

describe('RoleGuard (11-Permissões)', () => {
  const guard = new RoleGuard(new Reflector());

  it('rota sem @Roles(): não restringe papel', () => {
    expect(
      guard.canActivate(
        contextOf(OpenController, OpenController.prototype.open),
      ),
    ).toBe(true);
  });

  it('papel exigido pelo controller: ADMIN passa', () => {
    expect(
      guard.canActivate(
        contextOf(
          AdminController,
          AdminController.prototype.admin,
          userWith(UserRole.ADMIN),
        ),
      ),
    ).toBe(true);
  });

  it('papel exigido pelo controller: USER recebe 403', () => {
    expect(() =>
      guard.canActivate(
        contextOf(
          AdminController,
          AdminController.prototype.admin,
          userWith(UserRole.USER),
        ),
      ),
    ).toThrow(InsufficientRoleException);
  });

  it('o @Roles() do método prevalece sobre o do controller', () => {
    expect(
      guard.canActivate(
        contextOf(
          AdminController,
          AdminController.prototype.shared,
          userWith(UserRole.USER),
        ),
      ),
    ).toBe(true);
  });

  it('fecha por padrão: rota com papel exigido e sem usuário autenticado responde 401', () => {
    expect(() =>
      guard.canActivate(
        contextOf(AdminController, AdminController.prototype.admin),
      ),
    ).toThrow(NotAuthenticatedException);
  });

  it('o decorator grava os papéis no metadado da rota', () => {
    expect(
      new Reflector().get<UserRole[]>(REQUIRED_ROLES, AdminController),
    ).toEqual([UserRole.ADMIN]);
  });

  it('o 403 tem código próprio, distinto do 401', () => {
    const error = new InsufficientRoleException();

    expect(error.getStatus()).toBe(403);
    expect(error.code).toBe('INSUFFICIENT_ROLE');
  });
});

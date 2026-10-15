import type { ExecutionContext } from '@nestjs/common';
import { Controller, Get } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants.js';
import { UserRole } from '@prisma/client';
import { faker } from '@test/support/faker.js';
import {
  AUTHENTICATED_USER_KEY,
  CurrentUser,
} from './current-user.decorator.js';

type ParamFactory = (data: unknown, context: ExecutionContext) => unknown;

@Controller()
class ProbeController {
  @Get()
  whoAmI(@CurrentUser() user: unknown): unknown {
    return user;
  }
}

/** Fábrica do parâmetro, como o Nest a guarda nos metadados do handler. */
function factoryOf(): ParamFactory {
  const metadata = Reflect.getMetadata(
    ROUTE_ARGS_METADATA,
    ProbeController,
    'whoAmI',
  ) as Record<string, { factory: ParamFactory }>;

  return Object.values(metadata)[0].factory;
}

describe('CurrentUser', () => {
  it('entrega o usuário que o guard registrou na requisição', () => {
    const user = {
      userId: faker.database.mongodbObjectId(),
      sessionId: faker.database.mongodbObjectId(),
      familyId: faker.string.uuid(),
      role: UserRole.USER,
    };
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({ [AUTHENTICATED_USER_KEY]: user }),
      }),
    } as unknown as ExecutionContext;

    expect(factoryOf()(undefined, context)).toBe(user);
  });

  it('entrega undefined numa rota pública, onde não há usuário', () => {
    const context = {
      switchToHttp: () => ({ getRequest: () => ({}) }),
    } as unknown as ExecutionContext;

    expect(factoryOf()(undefined, context)).toBeUndefined();
  });
});

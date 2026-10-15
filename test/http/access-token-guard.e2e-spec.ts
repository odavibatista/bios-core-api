import { Controller, Get, type INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { UserRole } from '@prisma/client';
import {
  type UserSessionLink,
  UserSessionRepository,
} from '@modules/authentication/domain/dtos/repositories/user-session.repository.js';
import { AccessTokenProvider } from '@modules/authentication/domain/providers/access-token.provider.js';
import { AccessTokenGuard } from '@modules/authentication/http/guards/access-token.guard.js';
import {
  ACCESS_TOKEN_ISSUER,
  JwtAccessTokenProvider,
} from '@modules/authentication/infra/providers/jwt-access-token.provider.js';
import { validateEnvironment } from '@shared/config/environment.config.js';
import { ErrorResponseSchema } from '@shared/domain/dtos/errors/error-response.dto.js';
import type { AuthenticatedUser } from '@shared/domain/dtos/authenticated-user.dto.js';
import { CurrentUser } from '@shared/http/decorators/current-user.decorator.js';
import { Public } from '@shared/http/decorators/public.decorator.js';
import { AllExceptionsFilter } from '@shared/infra/filters/all-exceptions.filter.js';
import jsonwebtoken from 'jsonwebtoken';
import request from 'supertest';
import { buildTestEnvironment } from '../support/environment.js';
import { faker } from '../support/faker.js';

@Controller('prova')
class ProbeController {
  /** Sem decorator: o padrão é exigir sessão. */
  @Get('privada')
  private(@CurrentUser() user: AuthenticatedUser): AuthenticatedUser {
    return user;
  }

  @Public()
  @Get('publica')
  open(): { ok: true } {
    return { ok: true };
  }
}

/**
 * O guard global de autenticação ponta a ponta no HTTP (NFSE05): rota privada
 * por padrão, `@Public()` como exceção, e a revogação da sessão valendo na
 * requisição seguinte. O elo é um dublê em memória; o token é o real.
 */
describe('Guard de autenticação (e2e)', () => {
  const environment = validateEnvironment(buildTestEnvironment());
  const links = new Map<string, UserSessionLink>();
  let app: INestApplication;
  let accessTokens: AccessTokenProvider;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [() => environment],
        }),
      ],
      controllers: [ProbeController],
      providers: [
        { provide: AccessTokenProvider, useClass: JwtAccessTokenProvider },
        {
          provide: UserSessionRepository,
          useValue: {
            findById: (id: string) => Promise.resolve(links.get(id) ?? null),
          },
        },
        { provide: APP_GUARD, useClass: AccessTokenGuard },
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
    accessTokens = app.get(AccessTokenProvider);
  });

  beforeEach(() => {
    links.clear();
  });

  afterAll(async () => {
    await app.close();
  });

  /** Abre uma sessão no dublê e devolve o access token dela. */
  function openSession(overrides: Partial<UserSessionLink> = {}) {
    const userId = faker.database.mongodbObjectId();
    const link: UserSessionLink = {
      id: faker.database.mongodbObjectId(),
      userId,
      familyId: faker.string.uuid(),
      expiresAt: faker.date.soon({ days: 5 }),
      revokedAt: null,
      revocationReason: null,
      ...overrides,
    };
    links.set(link.id, link);
    const { token } = accessTokens.sign({
      userId,
      sessionId: link.id,
      role: UserRole.USER,
    });

    return { link, token };
  }

  function getPrivate(token?: string) {
    const call = request(app.getHttpServer()).get('/prova/privada');

    return token ? call.set('Authorization', `Bearer ${token}`) : call;
  }

  it('a rota sem decorator exige sessão: 401 sem token', async () => {
    const response = await getPrivate().expect(401);

    expect(ErrorResponseSchema.parse(response.body)).toMatchObject({
      code: 'NOT_AUTHENTICATED',
      path: '/prova/privada',
    });
  });

  it('a rota @Public() responde sem token', async () => {
    await request(app.getHttpServer()).get('/prova/publica').expect(200);
  });

  it('200 com sessão ativa, e o handler recebe o usuário autenticado', async () => {
    const { link, token } = openSession();

    const response = await getPrivate(token).expect(200);

    expect(response.body).toEqual({
      userId: link.userId,
      sessionId: link.id,
      familyId: link.familyId,
      role: UserRole.USER,
    });
  });

  it('a revogação da sessão vale já na requisição seguinte', async () => {
    const { link, token } = openSession();
    await getPrivate(token).expect(200);

    links.set(link.id, { ...link, revokedAt: new Date() });

    await getPrivate(token).expect(401);
  });

  it('401 com token adulterado', async () => {
    const { token } = openSession();
    const [header, body] = token.split('.');

    await getPrivate(
      `${header}.${body}.${faker.string.alphanumeric(43)}`,
    ).expect(401);
  });

  it('401 com token expirado', async () => {
    const { link } = openSession();
    const expired = jsonwebtoken.sign(
      { sid: link.id, role: UserRole.USER },
      environment.AUTH_ACCESS_TOKEN_SECRET,
      {
        algorithm: 'HS256',
        issuer: ACCESS_TOKEN_ISSUER,
        subject: link.userId,
        expiresIn: -10,
      },
    );

    await getPrivate(expired).expect(401);
  });

  it('401 com token válido de sessão que não existe mais', async () => {
    const { link, token } = openSession();
    links.delete(link.id);

    await getPrivate(token).expect(401);
  });

  it('todas as recusas respondem o mesmo corpo de erro', async () => {
    const { link, token } = openSession({ revokedAt: new Date() });

    const withoutToken = await getPrivate();
    const revoked = await getPrivate(token);
    const garbage = await getPrivate('nao-e-um-token');

    for (const response of [revoked, garbage]) {
      expect(ErrorResponseSchema.parse(response.body)).toMatchObject({
        code: ErrorResponseSchema.parse(withoutToken.body).code,
        message: ErrorResponseSchema.parse(withoutToken.body).message,
        statusCode: 401,
      });
    }
    expect(link.revokedAt).not.toBeNull();
  });
});

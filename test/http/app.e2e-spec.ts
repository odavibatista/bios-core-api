import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '@app/app.module.js';
import {
  OPENAPI_DOCUMENT_PATH,
  setupApiDocumentation,
} from '@shared/config/api-documentation.config.js';
import { ErrorResponseSchema } from '@shared/domain/dtos/errors/error-response.dto.js';
import { HealthCheckResponseSchema } from '@shared/domain/dtos/requests/health-check.dto.js';
import { PrismaService } from '@shared/infra/database/prisma.service.js';
import { RedisService } from '@shared/infra/redis/redis.service.js';
import { CheckHealthUseCase } from '@shared/infra/usecases/health/check-health.usecase.js';
import request from 'supertest';
import { healthCheckResponseFactory } from '../factories/shared/health-check-response.factory.js';
import { faker } from '../support/faker.js';
import { dereference } from '../support/openapi.js';

async function createApp(
  configure: (builder: ReturnType<typeof Test.createTestingModule>) => void,
): Promise<INestApplication> {
  const builder = Test.createTestingModule({ imports: [AppModule] });
  configure(builder);

  const app = (await builder.compile()).createNestApplication();
  setupApiDocumentation(app);
  await app.init();

  return app;
}

describe('API (e2e)', () => {
  const prisma = { isAvailable: vi.fn<() => Promise<boolean>>() };
  const redis = { isAvailable: vi.fn<() => Promise<boolean>>() };
  let app: INestApplication;

  beforeAll(async () => {
    app = await createApp((builder) =>
      builder
        .overrideProvider(PrismaService)
        .useValue(prisma)
        .overrideProvider(RedisService)
        .useValue(redis),
    );
  });

  beforeEach(() => {
    redis.isAvailable.mockResolvedValue(true);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /health', () => {
    it('200 com resposta conforme o schema quando as dependências estão disponíveis', async () => {
      prisma.isAvailable.mockResolvedValue(true);

      const response = await request(app.getHttpServer())
        .get('/health')
        .expect(200);

      expect(HealthCheckResponseSchema.safeParse(response.body).success).toBe(
        true,
      );
    });

    it.each([
      ['o banco', () => prisma.isAvailable.mockResolvedValue(false)],
      ['o Redis', () => redis.isAvailable.mockResolvedValue(false)],
    ])(
      '503 com erro padronizado quando %s está indisponível',
      async (_dependency, makeUnavailable) => {
        prisma.isAvailable.mockResolvedValue(true);
        makeUnavailable();

        const response = await request(app.getHttpServer())
          .get('/health')
          .expect(503);

        expect(ErrorResponseSchema.parse(response.body)).toMatchObject({
          code: 'DEPENDENCY_UNAVAILABLE',
          path: '/health',
        });
      },
    );
  });

  it('404 com erro padronizado para rota inexistente', async () => {
    const path = `/${faker.lorem.slug(3)}`;

    const response = await request(app.getHttpServer()).get(path).expect(404);

    expect(ErrorResponseSchema.parse(response.body)).toMatchObject({
      code: 'NOT_FOUND',
      message: 'Rota não encontrada.',
      path,
    });
  });

  describe('mensagens de erro em português', () => {
    /** Texto em inglês do framework ou do Zod que não pode chegar ao cliente. */
    const ENGLISH =
      /Invalid|expected|received|Cannot (GET|POST)|Unexpected token|entity too large|not valid JSON/i;

    const login = () =>
      request(app.getHttpServer())
        .post('/auth/login')
        .set('Content-Type', 'application/json');

    it('422: campo obrigatório ausente e mensagem escrita no schema', async () => {
      const response = await login().send({}).expect(422);
      const body = ErrorResponseSchema.parse(response.body);

      expect(body.details).toEqual(
        expect.arrayContaining([
          { path: 'email', message: 'Informe um e-mail válido.' },
          { path: 'password', message: 'Campo obrigatório.' },
        ]),
      );
      expect(JSON.stringify(body)).not.toMatch(ENGLISH);
    });

    it('422: tipo errado com a mensagem do locale pt-BR', async () => {
      const response = await login()
        .send({ email: faker.internet.email(), password: 12345678 })
        .expect(422);

      expect(ErrorResponseSchema.parse(response.body).details).toEqual([
        {
          path: 'password',
          message: 'Entrada inválida: esperava um texto, recebeu um número',
        },
      ]);
    });

    it('400: JSON malformado sem o texto do parser', async () => {
      const response = await login().send('nao-e-json').expect(400);
      const body = ErrorResponseSchema.parse(response.body);

      expect(body).toMatchObject({
        code: 'BAD_REQUEST',
        message: expect.stringContaining('JSON válido') as string,
      });
      expect(JSON.stringify(body)).not.toMatch(ENGLISH);
    });

    it('413: corpo grande demais responde 413 em português, e não 500', async () => {
      const response = await login()
        .send({ email: faker.internet.email(), password: 'x'.repeat(200_000) })
        .expect(413);

      const body = ErrorResponseSchema.parse(response.body);

      expect(body).toMatchObject({
        code: 'PAYLOAD_TOO_LARGE',
        message: 'O corpo da requisição é grande demais.',
      });
      expect(JSON.stringify(body)).not.toMatch(ENGLISH);
    });

    it('404: rota inexistente sem o texto "Cannot POST" do framework', async () => {
      const path = `/${faker.lorem.slug(3)}`;

      const response = await request(app.getHttpServer())
        .post(path)
        .send({})
        .expect(404);
      const body = ErrorResponseSchema.parse(response.body);

      expect(body).toMatchObject({
        code: 'NOT_FOUND',
        message: 'Rota não encontrada.',
        path,
      });
      expect(JSON.stringify(body)).not.toMatch(ENGLISH);
    });
  });

  it('publica o documento OpenAPI com os schemas de resposta gerados do Zod', async () => {
    const response = await request(app.getHttpServer())
      .get(OPENAPI_DOCUMENT_PATH)
      .expect(200);

    const healthResponses = dereference(
      response.body,
      response.body.paths['/health'].get.responses,
    );
    expect(
      healthResponses['200'].content['application/json'].schema.properties,
    ).toHaveProperty('checks');
    expect(
      healthResponses['503'].content['application/json'].schema.properties,
    ).toHaveProperty('code');
  });
});

describe('Serialização de respostas (e2e)', () => {
  const health = healthCheckResponseFactory.build();
  let app: INestApplication;

  beforeAll(async () => {
    app = await createApp((builder) =>
      builder.overrideProvider(CheckHealthUseCase).useValue({
        execute: () =>
          Promise.resolve({
            ...health,
            internal_secret: faker.internet.password(),
          }),
      }),
    );
  });

  afterAll(async () => {
    await app.close();
  });

  it('descarta campos não declarados no schema de resposta', async () => {
    const response = await request(app.getHttpServer())
      .get('/health')
      .expect(200);

    expect(response.body).toEqual(health);
  });
});

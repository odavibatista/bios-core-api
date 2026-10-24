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
      path,
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

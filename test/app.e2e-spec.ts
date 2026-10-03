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
import { CheckHealthUseCase } from '@shared/infra/usecases/health/check-health.usecase.js';
import request from 'supertest';

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
  let app: INestApplication;

  beforeAll(async () => {
    app = await createApp((builder) =>
      builder.overrideProvider(PrismaService).useValue(prisma),
    );
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /health', () => {
    it('200 com resposta conforme o schema quando o banco está disponível', async () => {
      prisma.isAvailable.mockResolvedValue(true);

      const response = await request(app.getHttpServer())
        .get('/health')
        .expect(200);

      expect(HealthCheckResponseSchema.safeParse(response.body).success).toBe(
        true,
      );
    });

    it('503 com erro padronizado quando o banco está indisponível', async () => {
      prisma.isAvailable.mockResolvedValue(false);

      const response = await request(app.getHttpServer())
        .get('/health')
        .expect(503);

      expect(ErrorResponseSchema.parse(response.body)).toMatchObject({
        code: 'DEPENDENCY_UNAVAILABLE',
        path: '/health',
      });
    });
  });

  it('404 com erro padronizado para rota inexistente', async () => {
    const response = await request(app.getHttpServer())
      .get('/inexistente')
      .expect(404);

    expect(ErrorResponseSchema.parse(response.body).code).toBe('NOT_FOUND');
  });

  it('publica o documento OpenAPI com os schemas de resposta gerados do Zod', async () => {
    const response = await request(app.getHttpServer())
      .get(OPENAPI_DOCUMENT_PATH)
      .expect(200);

    const healthResponses = response.body.paths['/health'].get.responses;
    expect(
      healthResponses['200'].content['application/json'].schema.properties,
    ).toHaveProperty('checks');
    expect(
      healthResponses['503'].content['application/json'].schema.properties,
    ).toHaveProperty('code');
  });
});

describe('Serialização de respostas (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createApp((builder) =>
      builder.overrideProvider(CheckHealthUseCase).useValue({
        execute: () =>
          Promise.resolve({
            status: 'ok',
            uptime_seconds: 1,
            checks: { database: 'up' },
            timestamp: '2026-10-03T12:00:00.000Z',
            internal_secret: 'nunca deve sair na resposta',
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

    expect(response.body).not.toHaveProperty('internal_secret');
    expect(response.body.checks).toEqual({ database: 'up' });
  });
});

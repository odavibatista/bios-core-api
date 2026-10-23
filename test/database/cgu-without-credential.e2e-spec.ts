import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RequestTrigger } from '@prisma/client';
import { inject } from 'vitest';
import request from 'supertest';
import { CATALOG_SEEDERS } from '@app/database/catalog.seeders.js';
import { GetCguCompanyEvidencesUseCase } from '@modules/cgu/infra/usecases/get-cgu-company-evidences.usecase.js';
import { RequestCguCompanyEvidencesUseCase } from '@modules/evidences/infra/usecases/request-cgu-company-evidences.usecase.js';
import {
  QUEUE_REGISTRY,
  type QueueRegistry,
} from '@shared/infra/providers/bullmq-queue.provider.js';
import { QueueName } from '@shared/domain/dtos/providers/queue-job.dto.js';
import { PrismaService } from '@shared/infra/database/prisma.service.js';
import {
  validateEnvironment,
  type Environment,
} from '@shared/config/environment.config.js';
import { buildCnpj } from '../factories/companies/company-profile.factory.js';
import { createDatabaseTestingApp } from '../support/database-testing-app.js';
import { buildTestEnvironmentWithout } from '../support/environment.js';

describe.runIf(inject('databaseAvailable') && inject('redisAvailable'))(
  'CGU sem credencial com AppModule, Mongo e Redis reais',
  () => {
    let app: INestApplication;
    let prisma: PrismaService;
    beforeAll(async () => {
      const environment = validateEnvironment({
        ...buildTestEnvironmentWithout('CGU_API_KEY'),
        DATABASE_URL: inject('testDatabaseUrl'),
        REDIS_URL: inject('testRedisUrl'),
        DATA_RETENTION_SYNC_ON_BOOT: 'false',
        QUEUE_SCHEDULES_SYNC_ON_BOOT: 'false',
      });
      const get = (key: keyof Environment) => environment[key];
      ({ app, prisma } = await createDatabaseTestingApp((builder) =>
        builder.overrideProvider(ConfigService).useValue({
          get,
          getOrThrow: (key: keyof Environment) => {
            const value = get(key);
            if (value === undefined)
              throw new Error(`Variável ausente: ${key}`);
            return value;
          },
        }),
      ));
    });

    beforeEach(async () => {
      await prisma.reset([
        'evidence_normalized',
        'evidence_raw',
        'data_source_request_logs',
        'ingestion_runs',
        'data_sources',
      ]);
      await prisma.seed(CATALOG_SEEDERS);
    });

    afterAll(async () => {
      if (app) await app.close();
    });

    it('sobe e responde health 200 informando a falta da chave', async () => {
      const response = await request(app.getHttpServer())
        .get('/health')
        .expect(200);
      expect(response.body).toMatchObject({
        status: 'ok',
        checks: { database: 'up', redis: 'up', cgu_credentials: 'missing' },
      });
    });

    it('produtor entrega UNKNOWN sem publicar job ou chamar a CGU', async () => {
      const cnpj = buildCnpj();
      const queue = app
        .get<QueueRegistry>(QUEUE_REGISTRY)
        .get(QueueName.ENVIRONMENTAL_EVIDENCES)!;
      const jobsBefore = await queue.getJobCounts();
      const result = await app
        .get(RequestCguCompanyEvidencesUseCase)
        .execute(cnpj);
      expect(result.map((e) => [e.sourceSlug, e.state]).sort()).toEqual(
        [
          ['CGU_CEIS', 'UNKNOWN'],
          ['CGU_CNEP', 'UNKNOWN'],
        ].sort(),
      );
      expect(await queue.getJobCounts()).toEqual(jobsBefore);
      expect(await prisma.dataSourceRequestLog.count()).toBe(0);
      expect(await prisma.evidenceRaw.count()).toBe(0);
    });

    it('consumidor direto tambem preserva UNKNOWN sem consulta externa', async () => {
      const result = await app.get(GetCguCompanyEvidencesUseCase).execute({
        cnpj: buildCnpj(),
        context: { trigger: RequestTrigger.ON_DEMAND_JOB },
      });
      expect(result.map((e) => [e.sourceSlug, e.state]).sort()).toEqual(
        [
          ['CGU_CEIS', 'UNKNOWN'],
          ['CGU_CNEP', 'UNKNOWN'],
        ].sort(),
      );
      expect(await prisma.dataSourceRequestLog.count()).toBe(0);
      expect(await prisma.evidenceRaw.count()).toBe(0);
    });
  },
);

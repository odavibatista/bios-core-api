import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { inject } from 'vitest';
import { createDatabaseTestingApp } from '../support/database-testing-app.js';

describe.runIf(inject('databaseAvailable'))(
  'GET /health com banco real (e2e)',
  () => {
    let app: INestApplication;

    beforeAll(async () => {
      ({ app } = await createDatabaseTestingApp());
    });

    afterAll(async () => {
      await app.close();
    });

    it('responde 200 com o banco disponível', async () => {
      const response = await request(app.getHttpServer())
        .get('/health')
        .expect(200);

      expect(response.body.checks).toEqual({ database: 'up' });
    });
  },
);

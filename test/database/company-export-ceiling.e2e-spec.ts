import type { INestApplication } from '@nestjs/common';
import { CATALOG_SEEDERS } from '@app/database/catalog.seeders.js';
import { ErrorResponseSchema } from '@shared/domain/dtos/errors/error-response.dto.js';
import { PrismaService } from '@shared/infra/database/prisma.service.js';
import request from 'supertest';
import { inject } from 'vitest';
import { createTestAccount } from '../support/test-account.js';
import { resetThrottleCounters } from '../support/throttle.js';
import { testRedisUrl } from '../support/infrastructure.js';

const REDIS_URL = testRedisUrl();

/** Teto configurado para esta suíte: pequeno, para o 422 acontecer com poucas empresas. */
const CEILING = 3;

/**
 * O teto de empresas da exportação vem da variável `EXPORT_MAX_COMPANIES` (#336), e não de uma
 * constante: a aplicação sobe com o valor configurado e o aplica de ponta a ponta, no banco
 * real. O caso do teto padrão (5000) fica em `company-export.e2e-spec.ts`.
 */
describe.runIf(inject('databaseAvailable') && inject('redisAvailable'))(
  'Teto configurável da exportação em XLSX (e2e)',
  () => {
    let app: INestApplication;
    let prisma: PrismaService;
    let sourceId: string;
    let accessToken: string;
    let originalCeiling: string | undefined;

    async function saveCompanies(count: number): Promise<void> {
      await prisma.companyProfile.createMany({
        data: Array.from({ length: count }, (_, index) => ({
          cnpj: String(index + 1).padStart(14, '0'),
          legal_name: `EMPRESA ${index + 1}`,
          registration_status: 'ATIVA',
          company_size: 'DEMAIS',
          address: { city: 'SANTOS', uf: 'SP' },
          main_cnae: { code: '6201501', description: 'DESENVOLVIMENTO' },
          secondary_cnaes: [],
          cadastral_source_id: sourceId,
          content_hash: 'hash',
          refreshed_at: new Date(),
        })),
      });
    }

    const exportXlsx = (query: Record<string, string | number>) =>
      request(app.getHttpServer())
        .get('/companies/export/xlsx')
        .query(query)
        .set('Authorization', `Bearer ${accessToken}`)
        .buffer(true)
        .parse((response, callback) => {
          const chunks: Buffer[] = [];

          response.on('data', (chunk: Buffer) => chunks.push(chunk));
          response.on('end', () => callback(null, Buffer.concat(chunks)));
        });

    beforeAll(async () => {
      // O ambiente é validado quando o AppModule é importado: a variável precisa estar
      // definida antes, e o import tem de ser dinâmico.
      originalCeiling = process.env.EXPORT_MAX_COMPANIES;
      process.env.EXPORT_MAX_COMPANIES = String(CEILING);

      const { createDatabaseTestingApp } =
        await import('../support/database-testing-app.js');

      ({ app, prisma } = await createDatabaseTestingApp());
      await prisma.seed(CATALOG_SEEDERS);
      sourceId = (
        await prisma.dataSource.findUniqueOrThrow({
          where: { slug: 'BRASIL_API' },
        })
      ).id_data_source;

      const account = await createTestAccount(app);
      const { body } = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: account.email, password: account.password })
        .expect(200);

      accessToken = body.access_token as string;
    });

    beforeEach(async () => {
      await resetThrottleCounters(REDIS_URL);
    });

    afterEach(async () => {
      await prisma.reset(['company_profile']);
    });

    afterAll(async () => {
      if (originalCeiling === undefined) {
        delete process.env.EXPORT_MAX_COMPANIES;
      } else {
        process.env.EXPORT_MAX_COMPANIES = originalCeiling;
      }
      await prisma.reset(['users', 'user_sessions', 'login_attempts']);
      await app.close();
    });

    it('no teto configurado, exporta', async () => {
      await saveCompanies(CEILING);

      const response = await exportXlsx({ uf: 'SP' }).expect(200);

      expect(response.headers['content-type']).toContain('spreadsheetml.sheet');
    });

    it('um acima do teto configurado: 422 EXPORT_TOO_LARGE com o total e o teto', async () => {
      await saveCompanies(CEILING + 1);

      const response = await exportXlsx({ uf: 'SP' }).expect(422);
      const error = ErrorResponseSchema.parse(
        JSON.parse(String(response.body)),
      );

      expect(error.code).toBe('EXPORT_TOO_LARGE');
      expect(error.details).toEqual({ total: CEILING + 1, max: CEILING });
    });

    it('a pesquisa paginada não é limitada pelo teto da exportação', async () => {
      await saveCompanies(CEILING + 2);

      const { body } = await request(app.getHttpServer())
        .get('/companies')
        .query({ uf: 'SP', page_size: 10 })
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(body.data).toHaveLength(CEILING + 2);
    });
  },
);

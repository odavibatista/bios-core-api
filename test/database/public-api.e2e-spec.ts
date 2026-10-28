import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { CATALOG_SEEDERS } from '@app/database/catalog.seeders.js';
import { LAST_USED_PRECISION_MS } from '@modules/api-keys/infra/usecases/authenticate-api-key.usecase.js';
import { CompanyFullProfileResponseSchema } from '@modules/environmental-intelligence/domain/dtos/requests/company-full-profile.dto.js';
import { API_KEY_HEADER } from '@shared/config/throttler.config.js';
import {
  type ErrorResponse,
  ErrorResponseSchema,
} from '@shared/domain/dtos/errors/error-response.dto.js';
import { PrismaService } from '@shared/infra/database/prisma.service.js';
import request from 'supertest';
import { inject } from 'vitest';
import { resetCache } from '../support/cache.js';
import { createDatabaseTestingApp } from '../support/database-testing-app.js';
import { withoutEnvironmentalCollection } from '../support/without-environmental-collection.js';
import { faker } from '../support/faker.js';
import { createTestAccount } from '../support/test-account.js';
import { resetThrottleCounters } from '../support/throttle.js';

const REDIS_URL = inject('testRedisUrl');

const CNPJ = '11222333000181';

/** Tamanho do prefixo público da chave: `bios_` + 8 caracteres. */
const PUBLIC_PREFIX_LENGTH = 'bios_'.length + 8;

/** Limite padrão da API pública (`THROTTLE_PUBLIC_API_LIMIT`). */
const PUBLIC_API_LIMIT = 60;

/**
 * Consulta de perfil pela API pública (UC12) ponta a ponta: o painel gera a
 * chave (UC11), o integrador a usa no cabeçalho `x-api-key`, e a chamada passa
 * pelo limite por chave, pelo guard da chave, pelo cache e pelo MongoDB. O
 * cadastro é gravado direto, dentro da validade, para que a consulta não
 * dependa do serviço de ingestão.
 */
describe.runIf(inject('databaseAvailable') && inject('redisAvailable'))(
  'API pública por chave de API (e2e)',
  () => {
    let app: INestApplication;
    let prisma: PrismaService;
    let accessToken: string;

    beforeAll(async () => {
      ({ app, prisma } = await createDatabaseTestingApp(
        withoutEnvironmentalCollection,
      ));
      await prisma.seed(CATALOG_SEEDERS);
      const source = await prisma.dataSource.findUniqueOrThrow({
        where: { slug: 'BRASIL_API' },
      });
      await prisma.companyProfile.create({
        data: {
          cnpj: CNPJ,
          cadastral_source_id: source.id_data_source,
          legal_name: faker.company.name(),
          trade_name: faker.company.name(),
          registration_status: 'ATIVA',
          company_size: 'DEMAIS',
          address: {
            street: 'Avenida Paulista',
            number: '1578',
            neighborhood: 'Bela Vista',
            city: 'São Paulo',
            city_ibge_code: '3550308',
            uf: 'SP',
            zipcode: '01310200',
          },
          main_cnae: {
            code: '6201501',
            description: 'Desenvolvimento de software',
          },
          secondary_cnaes: [],
          content_hash: faker.string.hexadecimal({ length: 64, prefix: '' }),
          refreshed_at: new Date(),
        },
      });

      const account = await createTestAccount(app);
      const { body } = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: account.email, password: account.password })
        .expect(200);
      accessToken = body.access_token as string;
    });

    beforeEach(async () => {
      await resetThrottleCounters(REDIS_URL);
      await resetCache(REDIS_URL);
    });

    afterEach(async () => {
      await prisma.reset(['api_keys']);
    });

    afterAll(async () => {
      await prisma.reset([
        'users',
        'user_sessions',
        'login_attempts',
        'company_profile',
      ]);
      await app.close();
    });

    /** Gera uma chave pelo painel (UC11) e devolve o valor completo e o id. */
    async function createKey(
      name = 'Integração',
    ): Promise<{ key: string; id: string }> {
      const { body } = await request(app.getHttpServer())
        .post('/api-keys')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ name })
        .expect(201);

      return { key: body.key as string, id: body.id as string };
    }

    const getProfile = (apiKey?: string, cnpj = CNPJ) => {
      const call = request(app.getHttpServer()).get(`/v1/companies/${cnpj}`);

      return apiKey ? call.set(API_KEY_HEADER, apiKey) : call;
    };

    /**
     * Mesmo prefixo público, segredo diferente e de formato válido: só o
     * resumo pode recusar. O prefixo tem tamanho fixo (`bios_` + 8) — o
     * segredo, em base64url, também contém `_`, então não se pode achar o
     * limite pelo último sublinhado.
     */
    const withWrongSecret = (key: string) =>
      `${key.slice(0, PUBLIC_PREFIX_LENGTH)}_${faker.string.alphanumeric(43)}`;

    const lastUsedAt = async (apiKeyId: string) =>
      (
        await prisma.apiKey.findUniqueOrThrow({
          where: { id_api_key: apiKeyId },
        })
      ).last_used_at ?? null;

    /** O que identifica uma recusa: tudo, menos `path` e `timestamp`. */
    const refusalOf = ({
      statusCode,
      code,
      message,
      details,
    }: ErrorResponse) => ({
      statusCode,
      code,
      message,
      details,
    });

    describe('com chave válida', () => {
      it('200: devolve o perfil completo, igual ao do painel, exceto pela proveniência (a pública não espera as fontes, #333)', async () => {
        const { key } = await createKey();

        const publicResponse = await getProfile(key).expect(200);
        const panelResponse = await request(app.getHttpServer())
          .get(`/companies/${CNPJ}`)
          .set('Authorization', `Bearer ${accessToken}`)
          .expect(200);

        const publicBody = CompanyFullProfileResponseSchema.parse(
          publicResponse.body,
        );
        const panelBody = CompanyFullProfileResponseSchema.parse(
          panelResponse.body,
        );

        expect(publicBody).toMatchObject({
          cnpj: CNPJ,
          registration_status: 'ATIVA',
          evidences: expect.any(Array),
          ods_scores: expect.any(Array),
        });

        const { provenance: publicProvenance, ...publicProfile } = publicBody;
        const { provenance: panelProvenance, ...panelProfile } = panelBody;

        expect(publicProfile).toEqual(panelProfile);
        // Sem coleta aqui, as fontes sem registro são pendentes para quem não esperou; o
        // painel as dá por indisponíveis.
        expect(
          publicProvenance.sources.every(({ origin }) => origin === 'PENDING'),
        ).toBe(true);
        expect(
          panelProvenance.sources.every(
            ({ origin }) => origin === 'UNAVAILABLE',
          ),
        ).toBe(true);
      });

      it('informa a cota nos cabeçalhos de limite', async () => {
        const { key } = await createKey();

        const response = await getProfile(key).expect(200);

        expect(response.headers['x-ratelimit-limit-publicapi']).toBe(
          String(PUBLIC_API_LIMIT),
        );
      });

      it('422: CNPJ inválido, depois de autenticar', async () => {
        const { key } = await createKey();

        const response = await getProfile(key, '11222333000182').expect(422);

        expect(ErrorResponseSchema.parse(response.body).code).toBe(
          'INVALID_CNPJ',
        );
      });
    });

    describe('último uso da chave', () => {
      it('registra o uso na primeira chamada', async () => {
        const { key, id } = await createKey();
        expect(await lastUsedAt(id)).toBeNull();
        const before = Date.now();

        await getProfile(key).expect(200);

        const usedAt = await lastUsedAt(id);
        expect(usedAt?.getTime()).toBeGreaterThanOrEqual(before - 1_000);
      });

      it('não regrava dentro da janela de precisão', async () => {
        const { key, id } = await createKey();
        await getProfile(key).expect(200);
        const first = await lastUsedAt(id);

        await getProfile(key).expect(200);

        expect(await lastUsedAt(id)).toEqual(first);
      });

      it('regrava quando o último registro é mais antigo que a janela', async () => {
        const { key, id } = await createKey();
        const old = new Date(Date.now() - 2 * LAST_USED_PRECISION_MS);
        await prisma.apiKey.update({
          where: { id_api_key: id },
          data: { last_used_at: old },
        });

        await getProfile(key).expect(200);

        const usedAt = await lastUsedAt(id);
        expect(usedAt?.getTime()).toBeGreaterThan(old.getTime());
      });

      it('aparece na listagem do painel', async () => {
        const { key, id } = await createKey();
        await getProfile(key).expect(200);

        const { body } = await request(app.getHttpServer())
          .get('/api-keys')
          .set('Authorization', `Bearer ${accessToken}`)
          .expect(200);

        const listed = (
          body.data as { id: string; last_used_at: string | null }[]
        ).find((item) => item.id === id);
        expect(listed?.last_used_at).not.toBeNull();
      });

      it('chamada recusada não registra uso', async () => {
        const { key, id } = await createKey();

        await getProfile(withWrongSecret(key)).expect(401);

        expect(await lastUsedAt(id)).toBeNull();
      });
    });

    describe('401: chave recusada', () => {
      it('sem o cabeçalho', async () => {
        const response = await getProfile().expect(401);

        expect(ErrorResponseSchema.parse(response.body).code).toBe(
          'INVALID_API_KEY',
        );
      });

      it('revogada no painel, com efeito imediato', async () => {
        const { key, id } = await createKey();
        await getProfile(key).expect(200);
        await request(app.getHttpServer())
          .delete(`/api-keys/${id}`)
          .set('Authorization', `Bearer ${accessToken}`)
          .expect(204);

        const response = await getProfile(key).expect(401);

        expect(ErrorResponseSchema.parse(response.body).code).toBe(
          'INVALID_API_KEY',
        );
      });

      it('mesma resposta para ausente, malformada, desconhecida, segredo errado e revogada', async () => {
        const { key, id } = await createKey();
        const unknown = `bios_${faker.string.alphanumeric(8)}_${faker.string.alphanumeric(43)}`;
        const wrongSecret = withWrongSecret(key);
        const revoked = await createKey('Revogada');
        await request(app.getHttpServer())
          .delete(`/api-keys/${revoked.id}`)
          .set('Authorization', `Bearer ${accessToken}`)
          .expect(204);

        const refusals = [];
        for (const candidate of [
          undefined,
          'lixo',
          unknown,
          wrongSecret,
          revoked.key,
        ]) {
          const response = await getProfile(candidate).expect(401);
          refusals.push(refusalOf(ErrorResponseSchema.parse(response.body)));
        }

        for (const refusal of refusals) expect(refusal).toEqual(refusals[0]);
        expect(await lastUsedAt(id)).toBeNull();
      });

      it('a sessão (JWT) não substitui a chave de API', async () => {
        await request(app.getHttpServer())
          .get(`/v1/companies/${CNPJ}`)
          .set('Authorization', `Bearer ${accessToken}`)
          .expect(401);
      });

      it('a chave de API não substitui a sessão nas rotas do painel', async () => {
        const { key } = await createKey();

        await request(app.getHttpServer())
          .get(`/companies/${CNPJ}`)
          .set(API_KEY_HEADER, key)
          .expect(401);
        await request(app.getHttpServer())
          .get('/api-keys')
          .set(API_KEY_HEADER, key)
          .expect(401);
      });
    });

    describe('429: limite de requisições por chave', () => {
      it('excedida a cota, responde 429 com Retry-After; outra chave segue livre', async () => {
        const first = await createKey('Primeira');
        const second = await createKey('Segunda');
        for (let attempt = 0; attempt < PUBLIC_API_LIMIT; attempt += 1) {
          await getProfile(first.key).expect(200);
        }

        const response = await getProfile(first.key).expect(429);

        expect(ErrorResponseSchema.parse(response.body).code).toBe(
          'RATE_LIMIT_EXCEEDED',
        );
        expect(Number(response.headers['retry-after'])).toBeGreaterThan(0);
        await getProfile(second.key).expect(200);
      });

      it('tentativas com chave inventada também gastam a cota, e o 429 vem antes do 401', async () => {
        const invented = `bios_${faker.string.alphanumeric(8)}_${faker.string.alphanumeric(43)}`;
        for (let attempt = 0; attempt < PUBLIC_API_LIMIT; attempt += 1) {
          await getProfile(invented).expect(401);
        }

        await getProfile(invented).expect(429);
      });

      it('esgotada a cota da chave, as rotas do painel seguem livres', async () => {
        const { key } = await createKey();
        for (let attempt = 0; attempt < PUBLIC_API_LIMIT; attempt += 1) {
          await getProfile(key).expect(200);
        }
        await getProfile(key).expect(429);

        await request(app.getHttpServer())
          .get('/accounts/me')
          .set('Authorization', `Bearer ${accessToken}`)
          .expect(200);
      });

      it('a cota do painel não é gasta pela API pública: o painel não conta no limite por chave', async () => {
        const { key } = await createKey();
        // O painel é chamado com a mesma chave no cabeçalho, mais vezes que a cota.
        for (let attempt = 0; attempt < PUBLIC_API_LIMIT + 5; attempt += 1) {
          await request(app.getHttpServer())
            .get('/accounts/me')
            .set('Authorization', `Bearer ${accessToken}`)
            .set(API_KEY_HEADER, key)
            .expect(200);
        }

        await getProfile(key).expect(200);
      });
    });

    describe('documentação OpenAPI (RF17)', () => {
      it('a rota pública declara o esquema de chave de API; a do painel, só o JWT', () => {
        const document = SwaggerModule.createDocument(
          app,
          new DocumentBuilder()
            .addBearerAuth({ type: 'http', scheme: 'bearer' }, 'jwt')
            .addApiKey(
              { type: 'apiKey', in: 'header', name: API_KEY_HEADER },
              'api-key',
            )
            .build(),
        );

        const securityOf = (path: string) =>
          document.paths[path]?.get?.security?.map((scheme) =>
            Object.keys(scheme),
          );

        expect(securityOf('/v1/companies/{cnpj}')).toEqual([['api-key']]);
        expect(securityOf('/companies/{cnpj}')).toEqual([['jwt']]);
      });
    });
  },
);

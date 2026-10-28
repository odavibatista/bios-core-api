import type { INestApplication } from '@nestjs/common';
import { AccessBlockReason, AccessBlockScope } from '@prisma/client';
import { DecoyCompanyListResponseSchema } from '@modules/honeypot/domain/dtos/requests/decoy-company.dto.js';
import { DECOY_RANDOM } from '@modules/honeypot/infra/providers/decoy-availability.js';
import { BlockedIpRegistry } from '@modules/security/domain/providers/blocked-ip-registry.provider.js';
import { BLOCKED_IPS_KEY } from '@modules/security/infra/providers/redis-blocked-ip-registry.provider.js';
import { ErrorResponseSchema } from '@shared/domain/dtos/errors/error-response.dto.js';
import { parseCnpj } from '@shared/domain/value-objects/cnpj.js';
import type { PrismaService } from '@shared/infra/database/prisma.service.js';
import { Redis } from 'ioredis';
import request from 'supertest';
import { inject } from 'vitest';
import { faker } from '../support/faker.js';
import { testRedisUrl } from '../support/infrastructure.js';
import { resetThrottleCounters } from '../support/throttle.js';

const REDIS_URL = testRedisUrl();

/**
 * Configuração desta suíte, aplicada antes de importar o `AppModule` (que valida o ambiente
 * ao ser importado). Os clientes "públicos" chegam pelo proxy de loopback, em
 * `X-Forwarded-For`, nas faixas de documentação (RFC 5737); 198.51.100.0/24 fica isenta.
 */
const ENVIRONMENT = {
  TRUST_PROXY: 'loopback',
  HONEYPOT_EXEMPT_IPS: '198.51.100.0/24',
  HONEYPOT_FAILURE_RATE: '0.5',
  HONEYPOT_MAX_DELAY_MS: '0',
};

/** IP público de teste, diferente a cada chamada. */
let lastOctet = 0;
const publicIp = () => `203.0.113.${(lastOctet += 1)}`;

/**
 * Honeypot (RF21, NFSE07, #87 e #88) com MongoDB, Redis e o proxy reverso reais: a isca
 * responde dados sintéticos, registra o acesso e bloqueia o IP em qualquer rota.
 */
describe.runIf(inject('databaseAvailable') && inject('redisAvailable'))(
  'Honeypot: endpoints isca e bloqueio do IP (e2e)',
  () => {
    let app: INestApplication;
    let prisma: PrismaService;
    let redis: Redis;
    /** Sorte da próxima chamada à isca: abaixo de 0,5 ela falha com 503. */
    let random = 0.9;
    const previous: Record<string, string | undefined> = {};

    const http = () => request(app.getHttpServer());
    const from = <T extends request.Test>(call: T, ip: string) =>
      call.set('X-Forwarded-For', ip);

    beforeAll(async () => {
      for (const [name, value] of Object.entries(ENVIRONMENT)) {
        previous[name] = process.env[name];
        process.env[name] = value;
      }
      const { createDatabaseTestingApp } =
        await import('../support/database-testing-app.js');
      ({ app, prisma } = await createDatabaseTestingApp((builder) => {
        builder.overrideProvider(DECOY_RANDOM).useValue(() => random);
      }));
      redis = new Redis(REDIS_URL);
    });

    beforeEach(async () => {
      random = 0.9;
      await prisma.reset(['honeypot_hits', 'access_blocks']);
      await redis.del(BLOCKED_IPS_KEY);
      await resetThrottleCounters(REDIS_URL);
    });

    afterAll(async () => {
      await prisma.reset(['honeypot_hits', 'access_blocks']);
      await redis.del(BLOCKED_IPS_KEY);
      redis.disconnect();
      await app.close();
      for (const [name, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    });

    describe('isca (#88)', () => {
      it('lista empresas sintéticas: no máximo 10 por página, com CNPJ válido', async () => {
        const { body } = await from(
          http().get('/v2/companies').query({ page: 3, page_size: 50 }),
          publicIp(),
        ).expect(200);
        const page = DecoyCompanyListResponseSchema.parse(body);

        expect(page.data).toHaveLength(10);
        expect(page.pagination).toMatchObject({ page: 3, page_size: 10 });
        for (const company of page.data) {
          expect(parseCnpj(company.cnpj)).toBe(company.cnpj);
          expect(company.address.uf).toMatch(/^[A-Z]{2}$/);
          expect(
            company.ods_scores.map(({ ods_number }) => ods_number),
          ).toEqual([13, 15]);
        }
      });

      it('o mesmo CNPJ devolve sempre a mesma empresa, para chamadores diferentes', async () => {
        const cnpj = '11222333000181';

        const first = await from(
          http().get(`/v2/companies/${cnpj}`),
          publicIp(),
        ).expect(200);
        const second = await from(
          http().get(`/v2/companies/${cnpj}`),
          publicIp(),
        ).expect(200);

        expect(second.body).toEqual(first.body);
        expect(first.body).toMatchObject({ cnpj });
      });

      it('nunca devolve dado real: a empresa gravada no banco não aparece na isca', async () => {
        const cnpj = '11222333000181';
        const response = await from(
          http().get(`/v2/companies/${cnpj}`),
          publicIp(),
        ).expect(200);

        expect(await prisma.companyProfile.count({ where: { cnpj } })).toBe(0);
        expect(response.body).not.toHaveProperty('provenance');
      });

      it('baixa disponibilidade proposital: na fração configurada responde 503, e o IP é bloqueado mesmo assim', async () => {
        const ip = publicIp();
        random = 0.1;

        const response = await from(http().get('/v2/companies'), ip).expect(
          503,
        );

        expect(ErrorResponseSchema.parse(response.body).code).toBe(
          'COMPANY_DATA_UNAVAILABLE',
        );
        await from(http().get('/health'), ip).expect(403);
      });

      it('CNPJ inválido responde 422, como a API real, e também bloqueia', async () => {
        const ip = publicIp();

        await from(http().get('/v2/companies/123'), ip).expect(422);
        await from(http().get('/health'), ip).expect(403);
      });

      it('fica fora da documentação: o OpenAPI não tem /v2', async () => {
        const { buildApiDocument } =
          await import('@shared/config/api-documentation.config.js');
        const paths = Object.keys(buildApiDocument(app).paths);

        expect(paths).toContain('/v1/companies/{cnpj}');
        expect(paths.filter((path) => path.startsWith('/v2'))).toEqual([]);
      });
    });

    describe('registro e bloqueio (#87)', () => {
      it('registra a chamada (IP, caminho, método, user-agent) e bloqueia o IP sem prazo', async () => {
        const ip = publicIp();
        const userAgent = faker.internet.userAgent();

        await from(
          http().get('/v2/companies?page=2').set('User-Agent', userAgent),
          ip,
        ).expect(200);

        await expect(prisma.honeypotHit.findMany()).resolves.toEqual([
          expect.objectContaining({
            ip,
            endpoint: '/v2/companies',
            http_method: 'GET',
            user_agent: userAgent,
          }),
        ]);
        const blocks = await prisma.accessBlock.findMany();
        expect(blocks).toEqual([
          expect.objectContaining({
            scope: AccessBlockScope.IP,
            ip,
            reason: AccessBlockReason.HONEYPOT,
            blocked_until: null,
          }),
        ]);
      });

      it('o IP bloqueado é recusado em qualquer rota, real ou isca, pública ou não', async () => {
        const ip = publicIp();
        await from(http().get('/v2/companies'), ip).expect(200);

        for (const call of [
          http().get('/health'),
          http().post('/auth/login').send({ email: 'a@b.com', password: 'x' }),
          http().get('/companies'),
          http().get('/v2/companies'),
        ]) {
          const response = await from(call, ip).expect(403);
          expect(ErrorResponseSchema.parse(response.body).code).toBe(
            'ACCESS_BLOCKED',
          );
        }
        // A recusa vem antes da isca: nenhuma chamada nova é registrada.
        expect(await prisma.honeypotHit.count()).toBe(1);
      });

      it('outros IPs seguem normalmente', async () => {
        await from(http().get('/v2/companies'), publicIp()).expect(200);

        await from(http().get('/health'), publicIp()).expect(200);
      });

      it('o IP vem do proxy confiável: entradas forjadas à esquerda do X-Forwarded-For não incriminam ninguém', async () => {
        const forged = publicIp();
        const caller = publicIp();

        await from(http().get('/v2/companies'), `${forged}, ${caller}`).expect(
          200,
        );

        await from(http().get('/health'), caller).expect(403);
        await from(http().get('/health'), forged).expect(200);
      });

      it('IP isento (HONEYPOT_EXEMPT_IPS) é registrado, mas nunca bloqueado', async () => {
        const ip = '198.51.100.7';

        await from(http().get('/v2/companies'), ip).expect(200);

        await from(http().get('/health'), ip).expect(200);
        expect(await prisma.honeypotHit.count({ where: { ip } })).toBe(1);
        expect(await prisma.accessBlock.count()).toBe(0);
      });

      it('o bloqueio sobrevive ao Redis sem a lista: a subida a recarrega do banco', async () => {
        const ip = publicIp();
        await from(http().get('/v2/companies'), ip).expect(200);
        await redis.del(BLOCKED_IPS_KEY);

        await from(http().get('/health'), ip).expect(200);
        await app
          .get<{ onApplicationBootstrap(): Promise<void> }>(BlockedIpRegistry)
          .onApplicationBootstrap();

        await from(http().get('/health'), ip).expect(403);
      });

      it('chamadas simultâneas do mesmo IP à isca: todas respondem e o IP fica bloqueado', async () => {
        const ip = publicIp();

        const statuses = (
          await Promise.all(
            Array.from({ length: 5 }, () =>
              from(http().get('/v2/companies'), ip),
            ),
          )
        ).map(({ status }) => status);

        expect(
          statuses.every((status) => status === 200 || status === 403),
        ).toBe(true);
        await from(http().get('/health'), ip).expect(403);
      });
    });
  },
);

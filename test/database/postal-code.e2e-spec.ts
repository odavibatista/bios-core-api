import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { RequestOutcome } from '@prisma/client';
import { CATALOG_SEEDERS } from '@app/database/catalog.seeders.js';
import { PrismaService } from '@shared/infra/database/prisma.service.js';
import request from 'supertest';
import { inject } from 'vitest';
import { resetCache } from '../support/cache.js';
import { createDatabaseTestingApp } from '../support/database-testing-app.js';
import { testRedisUrl } from '../support/infrastructure.js';
import { resetSourceRateLimits } from '../support/source-rate-limit.js';
import { createTestAccount } from '../support/test-account.js';
import { resetThrottleCounters } from '../support/throttle.js';

const REDIS_URL = testRedisUrl();
const CEP = '01310200';
const VIACEP_BODY = {
  cep: '01310-200',
  logradouro: 'Avenida Paulista',
  complemento: 'de 1047 a 1865 - lado ímpar',
  bairro: 'Bela Vista',
  localidade: 'São Paulo',
  uf: 'SP',
  ibge: '3550308',
  ddd: '11',
};

type Handler = () => { status: number; body: string } | null;

/** RF39 ponta a ponta: rota, catálogo e cache reais, com o ViaCEP num servidor local. */
describe.runIf(inject('databaseAvailable') && inject('redisAvailable'))(
  'Consulta de CEP (e2e)',
  () => {
    let app: INestApplication;
    let prisma: PrismaService;
    let server: Server;
    let baseUrl: string;
    let handler: Handler;
    let accessToken: string;
    const requested: string[] = [];
    const timers: NodeJS.Timeout[] = [];

    const lookup = (cep: string) =>
      request(app.getHttpServer())
        .get(`/locations/postal-codes/${cep}`)
        .set('Authorization', `Bearer ${accessToken}`);

    const found = () => ({ status: 200, body: JSON.stringify(VIACEP_BODY) });

    beforeAll(async () => {
      ({ app, prisma } = await createDatabaseTestingApp());
      server = createServer((incoming, response) => {
        requested.push(incoming.url ?? '');
        const answer = handler();

        if (answer === null) {
          timers.push(setTimeout(() => response.writeHead(200).end(), 5_000));

          return;
        }

        response
          .writeHead(answer.status, { 'content-type': 'application/json' })
          .end(answer.body);
      });
      await new Promise<void>((resolve) => {
        server.listen(0, '127.0.0.1', resolve);
      });
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/ws`;
    });

    beforeEach(async () => {
      await prisma.reset();
      await prisma.seed(CATALOG_SEEDERS);
      await resetCache(REDIS_URL);
      await resetThrottleCounters(REDIS_URL);
      await resetSourceRateLimits(REDIS_URL);
      await prisma.dataSource.update({
        where: { slug: 'VIACEP' },
        data: { base_url: baseUrl },
      });
      requested.length = 0;
      handler = found;

      const account = await createTestAccount(app);
      const { body } = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: account.email, password: account.password })
        .expect(200);

      accessToken = (body as { access_token: string }).access_token;
    });

    afterAll(async () => {
      timers.forEach(clearTimeout);
      server.closeAllConnections();
      await new Promise((resolve) => {
        server.close(resolve);
      });
      await app.close();
    });

    it('exige sessão', async () => {
      await request(app.getHttpServer())
        .get(`/locations/postal-codes/${CEP}`)
        .expect(401);
    });

    it('devolve o endereço, sem número nem complemento, e consulta só o CEP', async () => {
      const { body } = await lookup('01310-200').expect(200);

      expect(body).toEqual({
        postal_code: CEP,
        street: 'Avenida Paulista',
        neighborhood: 'Bela Vista',
        city: 'São Paulo',
        city_ibge_code: '3550308',
        state: 'SP',
      });
      expect(requested).toEqual([`/ws/${CEP}/json`]);
    });

    it('a segunda consulta vem do cache', async () => {
      await lookup(CEP).expect(200);
      await lookup(CEP).expect(200);

      expect(requested).toHaveLength(1);
    });

    it('usa o nome do catálogo quando a fonte escreve diferente', async () => {
      handler = () => ({
        status: 200,
        body: JSON.stringify({
          ...VIACEP_BODY,
          localidade: 'Parati',
          uf: 'RJ',
          ibge: '3303807',
        }),
      });

      const { body } = await lookup(CEP).expect(200);

      expect(body).toMatchObject({
        city: 'Paraty',
        city_ibge_code: '3303807',
        state: 'RJ',
      });
    });

    it('CEP inexistente responde 404 e não fica em cache', async () => {
      handler = () => ({ status: 200, body: '{"erro":"true"}' });

      const { body } = await lookup('99999999').expect(404);

      expect(body).toMatchObject({ code: 'POSTAL_CODE_NOT_FOUND' });

      await lookup('99999999').expect(404);
      expect(requested).toHaveLength(2);
    });

    it.each(['123', '01310-20', 'abcdefgh'])(
      'CEP mal formado (%s) responde 422 sem chamar a fonte',
      async (cep) => {
        await lookup(cep).expect(422);

        expect(requested).toEqual([]);
      },
    );

    it.each([
      ['erro da fonte', () => ({ status: 500, body: 'erro' })],
      ['resposta fora do contrato', () => ({ status: 200, body: '{}' })],
    ])('%s responde 503', async (_case, answer) => {
      handler = answer;

      const { body } = await lookup(CEP).expect(503);

      expect(body).toMatchObject({ code: 'POSTAL_CODE_LOOKUP_UNAVAILABLE' });
    });

    it('fonte que passa do prazo responde 503, dentro do tempo', async () => {
      await prisma.dataSource.update({
        where: { slug: 'VIACEP' },
        data: { request_timeout_ms: 200 },
      });
      handler = () => null;

      const startedAt = Date.now();

      await lookup(CEP).expect(503);

      expect(Date.now() - startedAt).toBeLessThan(3_000);
    });

    it('o log de requisições não guarda o CEP', async () => {
      await lookup(CEP).expect(200);

      const logs = await prisma.dataSourceRequestLog.findMany({});

      expect(logs).toHaveLength(1);
      expect(logs[0].outcome).toBe(RequestOutcome.SUCCESS);
      expect(JSON.stringify(logs)).not.toContain(CEP);
    });

    describe('endereço da conta', () => {
      const address = {
        postal_code: '23970-000',
        street: 'Rua da Lapa',
        number: '10',
        neighborhood: 'Centro',
        city: 'Parati',
        state: 'RJ',
      };
      const update = (body: object) =>
        request(app.getHttpServer())
          .patch('/accounts/me')
          .set('Authorization', `Bearer ${accessToken}`)
          .send({ address: body });

      it('grava o município escolhido com o nome do catálogo', async () => {
        const { body } = await update({
          ...address,
          city_ibge_code: '3303807',
        }).expect(200);

        expect(body).toMatchObject({
          address: { city: 'Paraty', city_ibge_code: '3303807', state: 'RJ' },
        });
      });

      it('recusa município de outra UF', async () => {
        const { body } = await update({
          ...address,
          state: 'SP',
          city_ibge_code: '3303807',
        }).expect(422);

        expect(body).toMatchObject({ code: 'CITY_NOT_IN_STATE' });
      });

      it('continua aceitando o endereço sem código', async () => {
        const { body } = await update(address).expect(200);

        expect(body).toMatchObject({ address: { city: 'Parati' } });
      });
    });
  },
);

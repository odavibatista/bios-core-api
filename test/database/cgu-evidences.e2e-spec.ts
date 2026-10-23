import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import {
  EvidenceState,
  EvidenceSignal,
  EvidenceCategory,
  RequestTrigger,
} from '@prisma/client';
import { inject } from 'vitest';
import { CATALOG_SEEDERS } from '@app/database/catalog.seeders.js';
import { ConfigService } from '@nestjs/config';
import { GetCguCompanyEvidencesUseCase } from '@modules/cgu/infra/usecases/get-cgu-company-evidences.usecase.js';
import { PrismaService } from '@shared/infra/database/prisma.service.js';
import { CacheProvider } from '@shared/domain/providers/cache.provider.js';
import { CacheNamespace } from '@shared/domain/dtos/providers/cache-key.dto.js';
import {
  cguRowFactory,
  otherCguCnpj,
} from '../factories/cgu/cgu-sanction.factory.js';
import { buildCnpj } from '../factories/companies/company-profile.factory.js';
import { buildDistinctCnpjs } from '../support/cnpj.js';
import { faker } from '../support/faker.js';
import { createDatabaseTestingApp } from '../support/database-testing-app.js';
import { resetCache } from '../support/cache.js';
import { resetSourceRateLimits } from '../support/source-rate-limit.js';

const redisUrl = inject('testRedisUrl');
const context = { trigger: RequestTrigger.USER_QUERY };

describe.runIf(inject('databaseAvailable') && inject('redisAvailable'))(
  'CGU com HTTP, MongoDB e Redis reais (e2e)',
  () => {
    let app: INestApplication;
    let prisma: PrismaService;
    let collect: GetCguCompanyEvidencesUseCase;
    let cache: CacheProvider;
    let server: Server;
    let baseUrl: string;
    let cnpj: string;
    let responses: Record<
      string,
      { status: number; pages: unknown[]; delay?: number }
    >;
    let calls: {
      path: string;
      page: number;
      cnpj: string | null;
      authenticated: boolean;
    }[];
    let token: string;
    const run = () => collect.execute({ cnpj, context });
    const row = () =>
      cguRowFactory.build({
        sancionado: { codigoFormatado: cnpj, nome: faker.person.fullName() },
      });

    beforeAll(async () => {
      ({ app, prisma } = await createDatabaseTestingApp());
      collect = app.get(GetCguCompanyEvidencesUseCase);
      cache = app.get(CacheProvider);
      token = app.get(ConfigService).getOrThrow<string>('CGU_API_KEY');
      server = createServer((req, res) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        const page = Number(url.searchParams.get('pagina'));
        calls.push({
          path: url.pathname,
          page,
          cnpj: url.searchParams.get('codigoSancionado'),
          authenticated: req.headers['chave-api-dados'] === token,
        });
        const answer = responses[url.pathname];
        if (!answer) {
          res.writeHead(404).end();
          return;
        }
        const send = () =>
          res
            .writeHead(answer.status, { 'Content-Type': 'application/json' })
            .end(JSON.stringify(answer.pages[page - 1] ?? []));
        if (answer.delay) setTimeout(send, answer.delay);
        else send();
      });
      await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve),
      );
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });

    beforeEach(async () => {
      cnpj = buildCnpj();
      calls = [];
      responses = {
        '/ceis': { status: 200, pages: [[]] },
        '/cnep': { status: 200, pages: [[]] },
      };
      await prisma.reset([
        'evidence_normalized',
        'evidence_raw',
        'data_source_request_logs',
        'ingestion_runs',
        'data_sources',
      ]);
      await prisma.seed(CATALOG_SEEDERS);
      for (const register of ['ceis', 'cnep'])
        await prisma.dataSource.update({
          where: { slug: `CGU_${register.toUpperCase()}` },
          data: { base_url: `${baseUrl}/${register}` },
        });
      await resetCache(redisUrl);
      await resetSourceRateLimits(redisUrl);
    });

    afterAll(async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await resetCache(redisUrl);
      await resetSourceRateLimits(redisUrl);
      await prisma.reset([
        'evidence_normalized',
        'evidence_raw',
        'data_source_request_logs',
      ]);
      await app.close();
    });

    it('consolida todas as páginas, descarta PF e dados pessoais e usa o catálogo', async () => {
      const first = row(),
        second = row(),
        third = row();
      const person = cguRowFactory.build({
        sancionado: {
          codigoFormatado: '***.456.789-**',
          nome: faker.person.fullName(),
        },
      });
      responses['/ceis'].pages = [[first], [person], [second], []];
      responses['/cnep'].pages = [[third], []];
      const result = await run();
      expect(result).toHaveLength(3);
      expect(
        result.every(
          (e) =>
            e.category === EvidenceCategory.CONDUTA_ADMINISTRATIVA &&
            e.odsNumber === 15 &&
            e.signal === EvidenceSignal.NEGATIVE &&
            e.state === EvidenceState.CONFIRMED &&
            e.rawEvidenceId,
        ),
      ).toBe(true);
      expect(
        result.find((e) => e.sourceReference === String(first.id)),
      ).toMatchObject({
        sourceUrl: `https://api.portaldatransparencia.gov.br/api-de-dados/ceis/${first.id}`,
        details: expect.objectContaining({ endDate: '2021-02-01' }),
      });
      expect(
        calls.every((call) => call.cnpj === cnpj && call.authenticated),
      ).toBe(true);
      expect(
        calls.filter((call) => call.path === '/ceis').map((call) => call.page),
      ).toEqual([1, 2, 3, 4]);
      const raw = await prisma.evidenceRaw.findMany();
      expect(raw).toHaveLength(3);
      const cacheValue = await cache.get({
        namespace: CacheNamespace.CGU_CEIS,
        identifier: cnpj,
      });
      const logs = await prisma.dataSourceRequestLog.findMany();
      expect(logs).toHaveLength(6);
      const serialized = JSON.stringify([raw, result, cacheValue, logs]);
      for (const forbidden of [
        token,
        first.sancionado.nome,
        first.pessoa.cpfFormatado,
        person.sancionado.nome,
        person.sancionado.codigoFormatado,
        first.linkPublicacao,
      ])
        expect(serialized).not.toContain(forbidden);
      expect(
        result.every(
          (e) => e.validUntil.getTime() - e.collectedAt.getTime() === 86400000,
        ),
      ).toBe(true);
    });

    it('cache mantém data e validade originais e isola outro CNPJ', async () => {
      responses['/ceis'].pages = [[row()], []];
      const first = await run();
      const total = calls.length;
      const repeated = await run();
      expect(calls).toHaveLength(total);
      expect(repeated.map((e) => [e.collectedAt, e.validUntil])).toEqual(
        first.map((e) => [e.collectedAt, e.validUntil]),
      );
      expect(await prisma.evidenceRaw.count()).toBe(1);
      cnpj = otherCguCnpj(cnpj);
      await run();
      expect(calls.length).toBeGreaterThan(total);
    });

    it('resposta vazia confirma NOT_FOUND sem sinal positivo e fica em cache', async () => {
      const result = await run();
      expect(result).toHaveLength(2);
      expect(
        result.every(
          (e) =>
            e.state === EvidenceState.NOT_FOUND &&
            e.signal !== EvidenceSignal.POSITIVE,
        ),
      ).toBe(true);
      expect(await prisma.evidenceRaw.count()).toBe(0);
      await run();
      expect(calls).toHaveLength(2);
    });

    it.each([401, 403, 404, 429, 500])(
      'HTTP %s vira UNKNOWN apenas na fonte afetada e permite nova tentativa',
      async (status) => {
        responses['/ceis'].status = status;
        const result = await run();
        expect(result.find((e) => e.sourceSlug === 'CGU_CEIS')?.state).toBe(
          EvidenceState.UNKNOWN,
        );
        expect(result.find((e) => e.sourceSlug === 'CGU_CNEP')?.state).toBe(
          EvidenceState.NOT_FOUND,
        );
        responses['/ceis'].status = 200;
        responses['/ceis'].pages = [[row()], []];
        const recovered = await run();
        expect(recovered.find((e) => e.sourceSlug === 'CGU_CEIS')?.state).toBe(
          EvidenceState.CONFIRMED,
        );
        const log = await prisma.dataSourceRequestLog.findFirst({
          where: { http_status: status },
        });
        expect(log).not.toBeNull();
      },
    );

    it('timeout não impede a outra fonte nem grava bruto parcial', async () => {
      await prisma.dataSource.update({
        where: { slug: 'CGU_CEIS' },
        data: { request_timeout_ms: 30 },
      });
      responses['/ceis'].delay = 150;
      const result = await run();
      expect(result.find((e) => e.sourceSlug === 'CGU_CEIS')?.state).toBe(
        EvidenceState.UNKNOWN,
      );
      expect(result.find((e) => e.sourceSlug === 'CGU_CNEP')?.state).toBe(
        EvidenceState.NOT_FOUND,
      );
      expect(await prisma.evidenceRaw.count()).toBe(0);
    });

    it('falha numa página posterior não persiste achados parciais', async () => {
      responses['/ceis'].pages = [[row()], { erro: 'formato inválido' }];
      const result = await run();
      expect(result.find((e) => e.sourceSlug === 'CGU_CEIS')?.state).toBe(
        EvidenceState.UNKNOWN,
      );
      expect(await prisma.evidenceRaw.count()).toBe(0);
      expect(
        await cache.get({
          namespace: CacheNamespace.CGU_CEIS,
          identifier: cnpj,
        }),
      ).toBeUndefined();
    });

    it('fonte desabilitada ignora cache e preserva o que já foi confirmado, inclusive vencido', async () => {
      responses['/ceis'].pages = [[row()], []];
      const first = await run();
      const ceis = first.find((e) => e.sourceSlug === 'CGU_CEIS')!;
      await prisma.evidenceNormalized.update({
        where: { id_evidence: ceis.id },
        data: { valid_until: new Date(Date.now() - 10000) },
      });
      await prisma.dataSource.update({
        where: { slug: 'CGU_CEIS' },
        data: { is_enabled: false },
      });
      const total = calls.length;
      const result = await run();
      expect(calls).toHaveLength(total);
      expect(result.find((e) => e.sourceSlug === 'CGU_CEIS')).toMatchObject({
        id: ceis.id,
        state: EvidenceState.OUTDATED,
      });
    });

    it('nova resposta completa substitui a fonte sem alterar outra empresa', async () => {
      responses['/ceis'].pages = [[row()], []];
      await run();
      const firstCnpj = cnpj;
      cnpj = otherCguCnpj(cnpj);
      responses['/ceis'].pages = [[row()], []];
      await run();
      cnpj = firstCnpj;
      // Limpar cache nao invalida a resposta local ainda valida (RF07).
      await prisma.evidenceNormalized.updateMany({
        where: { cnpj, data_source: { slug: 'CGU_CEIS' } },
        data: { valid_until: new Date(0) },
      });
      await resetCache(redisUrl);
      responses['/ceis'].pages = [[]];
      const result = await run();
      expect(result.find((e) => e.sourceSlug === 'CGU_CEIS')?.state).toBe(
        EvidenceState.NOT_FOUND,
      );
      expect(
        await prisma.evidenceNormalized.count({
          where: { cnpj: { not: firstCnpj }, state: EvidenceState.CONFIRMED },
        }),
      ).toBe(1);
    });

    it('limite do catálogo interrompe a paginação sem confirmar ausência', async () => {
      await prisma.dataSource.update({
        where: { slug: 'CGU_CEIS' },
        data: { rate_limit_per_minute: 1 },
      });
      // O contador é comum aos dois cadastros: sem o CNEP na disputa, o CEIS
      // fica com a única chamada e a página 2 é a que o limite recusa.
      await prisma.dataSource.update({
        where: { slug: 'CGU_CNEP' },
        data: { is_enabled: false },
      });
      responses['/ceis'].pages = [[row()], []];
      const result = await run();
      expect(result.find((e) => e.sourceSlug === 'CGU_CEIS')?.state).toBe(
        EvidenceState.UNKNOWN,
      );
      expect(calls.filter((call) => call.path === '/ceis')).toHaveLength(1);
      expect(await prisma.evidenceRaw.count()).toBe(0);
    });

    it('CEIS e CNEP dividem o limite: a soma das chamadas à CGU nunca passa dele', async () => {
      const limit = 5;
      for (const slug of ['CGU_CEIS', 'CGU_CNEP'])
        await prisma.dataSource.update({
          where: { slug },
          data: { rate_limit_per_minute: limit },
        });
      // Dez empresas ao mesmo tempo, cada uma com uma chamada por cadastro:
      // 20 tentativas disputando 5 vagas num único contador.
      const companies = buildDistinctCnpjs(10);

      const results = await Promise.all(
        companies.map((company) => collect.execute({ cnpj: company, context })),
      );

      expect(calls).toHaveLength(limit);
      // Só as chamadas que passaram confirmam ausência; cada recusa fica UNKNOWN,
      // nunca ausência confirmada, e não é repetida (o servidor viu só ${limit}).
      const states = results.flat().map((evidence) => evidence.state);
      expect(
        states.filter((state) => state === EvidenceState.NOT_FOUND),
      ).toHaveLength(limit);
      expect(
        states.every(
          (state) =>
            state === EvidenceState.NOT_FOUND ||
            state === EvidenceState.UNKNOWN,
        ),
      ).toBe(true);
    });
  },
);

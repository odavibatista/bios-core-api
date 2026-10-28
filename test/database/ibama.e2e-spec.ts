import { createHash } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import type { INestApplication } from '@nestjs/common';
import { RequestOutcome, RequestTrigger } from '@prisma/client';
import { CATALOG_SEEDERS } from '@app/database/catalog.seeders.js';
import {
  IbamaDumpFormatError,
  type IbamaDump,
  type IbamaRecord,
} from '@modules/ibama/domain/dtos/providers/ibama-dump.dto.js';
import {
  IBAMA_RESOURCES,
  IbamaResource,
} from '@modules/ibama/domain/ibama-resource.js';
import { IbamaDataSource } from '@modules/ibama/infra/providers/ibama.data-source.js';
import { PrismaService } from '@shared/infra/database/prisma.service.js';
import { inject } from 'vitest';
import {
  AUTO_INFRACAO_COLUMNS,
  autoInfracaoRowFactory,
  IBAMA_CNPJ,
  IBAMA_CPF,
  IBAMA_CPF_MASKED,
  IBAMA_OTHER_CNPJ,
  termoEmbargoRowFactory,
  TERMO_EMBARGO_COLUMNS,
  toIbamaCsv,
} from '../factories/ibama/ibama-dump.factory.js';
import { createDatabaseTestingApp } from '../support/database-testing-app.js';
import { resetSourceRateLimits } from '../support/source-rate-limit.js';
import { buildZip } from '../support/zip.js';
import { testRedisUrl } from '../support/infrastructure.js';

const REDIS_URL = testRedisUrl();
const context = { trigger: RequestTrigger.SCHEDULED_JOB };
const AUTO_PATH = `/${IBAMA_RESOURCES.AUTO_INFRACAO.segments.join('/')}`;
const EMBARGO_PATH = `/${IBAMA_RESOURCES.TERMO_EMBARGO.segments.join('/')}`;

type Behavior = 'ok' | 'not-found' | 'error' | 'hang' | 'truncated';

/** Pastas temporárias que o adapter cria (e que precisam sumir). */
function ibamaTempDirectories(): string[] {
  return readdirSync(tmpdir()).filter((name) => name.startsWith('bios-ibama-'));
}

/**
 * Adapter do IBAMA contra o catálogo do seed, banco e Redis reais (UC14): o
 * download dos dumps (um `.zip` de CSVs por ano e um CSV com BOM) de um servidor
 * local, a leitura em fluxo e o descarte de pessoa física antes de qualquer
 * persistência (INL02).
 */
describe.runIf(inject('databaseAvailable') && inject('redisAvailable'))(
  'Adapter IBAMA (e2e)',
  () => {
    let app: INestApplication;
    let prisma: PrismaService;
    let dataSource: IbamaDataSource;
    let server: Server;
    let baseUrl: string;
    let autoZip: Buffer;
    let embargoCsv: string;
    const behavior: Record<string, Behavior> = {};
    const requested: string[] = [];
    const timers: NodeJS.Timeout[] = [];
    const dumps: IbamaDump[] = [];

    function buildAutoZip(
      rows2024: ReturnType<typeof autoInfracaoRowFactory.buildMany>,
    ) {
      return buildZip([
        {
          name: 'auto_infracao_2023.csv',
          content: toIbamaCsv(AUTO_INFRACAO_COLUMNS, [
            autoInfracaoRowFactory.build({
              NUM_AUTO_INFRACAO: '100',
              SER_AUTO_INFRACAO: 'A',
            }),
            autoInfracaoRowFactory.build({
              NUM_AUTO_INFRACAO: '101',
              TP_PESSOA_INFRATOR: 'PF',
              CPF_CNPJ_INFRATOR: IBAMA_CPF_MASKED,
            }),
          ]),
        },
        {
          name: 'auto_infracao_2024.csv',
          content: toIbamaCsv(AUTO_INFRACAO_COLUMNS, rows2024),
        },
      ]);
    }

    function setDumps() {
      autoZip = buildAutoZip([
        autoInfracaoRowFactory.build({
          NUM_AUTO_INFRACAO: '200',
          SER_AUTO_INFRACAO: 'E',
          CPF_CNPJ_INFRATOR: IBAMA_OTHER_CNPJ,
        }),
        autoInfracaoRowFactory.build({
          NUM_AUTO_INFRACAO: '201',
          TP_PESSOA_INFRATOR: 'PJ',
          CPF_CNPJ_INFRATOR: IBAMA_CPF,
        }),
        autoInfracaoRowFactory.build({
          NUM_AUTO_INFRACAO: '202',
          TP_PESSOA_INFRATOR: '',
          CPF_CNPJ_INFRATOR: '',
        }),
      ]);
      embargoCsv = toIbamaCsv(
        TERMO_EMBARGO_COLUMNS,
        [
          termoEmbargoRowFactory.build({ NUM_TAD: 'AAAA1111', SER_TAD: '' }),
          termoEmbargoRowFactory.build({
            NUM_TAD: 'BBBB2222',
            CPF_CNPJ_EMBARGADO: IBAMA_CPF,
          }),
        ],
        { quoteAll: true, bom: true },
      );
    }

    beforeAll(async () => {
      ({ app, prisma } = await createDatabaseTestingApp());
      dataSource = app.get(IbamaDataSource, { strict: false });
      server = createServer((request, response) => {
        const path = request.url ?? '';
        requested.push(path);
        const mode = behavior[path] ?? 'ok';
        const body = path === AUTO_PATH ? autoZip : Buffer.from(embargoCsv);

        if (mode === 'not-found') {
          response.writeHead(404).end('nao encontrado');
        } else if (mode === 'error') {
          response.writeHead(500).end('erro');
        } else if (mode === 'hang') {
          response.writeHead(200);
          response.write(body.subarray(0, 100));
          timers.push(setTimeout(() => response.end(), 5_000));
        } else if (mode === 'truncated') {
          response.writeHead(200).end(body.subarray(0, body.length / 2));
        } else {
          response.writeHead(200, {
            'content-type': 'application/octet-stream',
          });
          response.end(body);
        }
      });
      await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve),
      );
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });

    beforeEach(async () => {
      requested.length = 0;
      for (const key of Object.keys(behavior)) delete behavior[key];
      setDumps();
      await prisma.reset(['data_sources', 'data_source_request_logs']);
      await prisma.seed(CATALOG_SEEDERS);
      await prisma.dataSource.update({
        where: { slug: 'IBAMA' },
        data: { base_url: baseUrl },
      });
      await resetSourceRateLimits(REDIS_URL);
    });

    afterEach(async () => {
      timers.splice(0).forEach(clearTimeout);
      await Promise.all(dumps.splice(0).map((dump) => dump.dispose()));
    });

    afterAll(async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await prisma.reset(['data_sources', 'data_source_request_logs']);
      await resetSourceRateLimits(REDIS_URL);
      await app.close();
    });

    const logs = () =>
      prisma.dataSourceRequestLog.findMany({
        where: { data_source: { slug: 'IBAMA' } },
        orderBy: { requested_at: 'asc' },
      });

    async function open(resource: IbamaResource): Promise<IbamaDump> {
      const result = await dataSource.download(resource, context);

      expect(result.status).toBe('FOUND');
      if (result.status !== 'FOUND') throw new Error('dump não baixado');
      dumps.push(result.data);

      return result.data;
    }

    async function collect(dump: IbamaDump): Promise<IbamaRecord[]> {
      const records: IbamaRecord[] = [];

      for await (const record of dump.records()) records.push(record);

      return records;
    }

    describe('auto de infração (.zip com um CSV por ano)', () => {
      it('baixa do caminho do recurso, a partir da base_url do catálogo', async () => {
        await open(IbamaResource.AUTO_INFRACAO);

        expect(requested).toEqual([AUTO_PATH]);
      });

      it('lê os CSVs de todos os anos e entrega só a pessoa jurídica', async () => {
        const dump = await open(IbamaResource.AUTO_INFRACAO);

        const records = await collect(dump);

        expect(records.map(({ reference, cnpj }) => [reference, cnpj])).toEqual(
          [
            ['100-A', IBAMA_CNPJ],
            ['200-E', IBAMA_OTHER_CNPJ],
          ],
        );
        expect(dump.stats).toEqual({
          rows: 5,
          kept: 2,
          discarded: {
            PESSOA_FISICA: 2,
            SEM_DOCUMENTO: 1,
            DOCUMENTO_INVALIDO: 0,
            REGISTRO_MALFORMADO: 0,
          },
        });
      });

      it('nenhum CPF nem nome de autuado chega a um registro entregue', async () => {
        const dump = await open(IbamaResource.AUTO_INFRACAO);

        const serialized = JSON.stringify(await collect(dump));

        expect(serialized).not.toContain(IBAMA_CPF);
        expect(serialized).not.toContain('123.456.789');
        expect(serialized).not.toContain('NOME_INFRATOR');
        expect(serialized).not.toContain('POLYGON');
      });

      it('o checksum e o tamanho são os do arquivo servido', async () => {
        const dump = await open(IbamaResource.AUTO_INFRACAO);

        expect(dump.checksum).toBe(
          createHash('sha256').update(autoZip).digest('hex'),
        );
        expect(dump.bytes).toBe(autoZip.length);
      });

      it('o mesmo dump tem o mesmo checksum; um dump diferente, outro', async () => {
        const first = await open(IbamaResource.AUTO_INFRACAO);
        const same = await open(IbamaResource.AUTO_INFRACAO);
        autoZip = buildAutoZip([autoInfracaoRowFactory.build()]);
        const other = await open(IbamaResource.AUTO_INFRACAO);

        expect(same.checksum).toBe(first.checksum);
        expect(other.checksum).not.toBe(first.checksum);
      });

      it('lê um volume grande em fluxo, sem perder nem repetir registros', async () => {
        const rows = autoInfracaoRowFactory.buildMany(20_000, {
          DES_AUTO_INFRACAO: 'texto',
        });
        rows.forEach((row, index) => {
          row.NUM_AUTO_INFRACAO = String(1_000 + index);
          if (index % 4 === 0) {
            row.TP_PESSOA_INFRATOR = 'PF';
            row.CPF_CNPJ_INFRATOR = IBAMA_CPF_MASKED;
          }
        });
        autoZip = buildAutoZip(rows);
        const dump = await open(IbamaResource.AUTO_INFRACAO);

        const records = await collect(dump);

        expect(records).toHaveLength(15_001);
        expect(new Set(records.map(({ reference }) => reference)).size).toBe(
          15_001,
        );
        expect(dump.stats.discarded.PESSOA_FISICA).toBe(5_001);
      });
    });

    describe('termo de embargo (CSV único, com BOM e aspas)', () => {
      it('lê o CSV e entrega só a pessoa jurídica', async () => {
        const dump = await open(IbamaResource.TERMO_EMBARGO);

        const records = await collect(dump);

        expect(requested).toEqual([EMBARGO_PATH]);
        expect(records).toHaveLength(1);
        expect(records[0]).toMatchObject({
          resource: IbamaResource.TERMO_EMBARGO,
          cnpj: IBAMA_CNPJ,
          reference: 'AAAA1111',
        });
        expect(dump.stats.discarded.PESSOA_FISICA).toBe(1);
        expect(JSON.stringify(records)).not.toContain(IBAMA_CPF);
      });
    });

    describe('log de requisições', () => {
      it('registra o download, com a origem e o status, sem CNPJ (é um dump, não uma consulta)', async () => {
        await open(IbamaResource.TERMO_EMBARGO);

        const [log, ...rest] = await logs();

        expect(rest).toHaveLength(0);
        expect(log).toMatchObject({
          trigger: RequestTrigger.SCHEDULED_JOB,
          outcome: RequestOutcome.SUCCESS,
          http_status: 200,
        });
        expect(log.cnpj ?? null).toBeNull();
      });
    });

    describe('a fonte não entregou o dump', () => {
      it('404: UNAVAILABLE com o motivo (e não "sem registro"), registrado como NOT_FOUND', async () => {
        behavior[AUTO_PATH] = 'not-found';
        const before = ibamaTempDirectories();

        const result = await dataSource.download(
          IbamaResource.AUTO_INFRACAO,
          context,
        );

        expect(result).toMatchObject({
          status: 'UNAVAILABLE',
          message: expect.stringContaining('base_url'),
        });
        expect((await logs())[0]).toMatchObject({
          outcome: RequestOutcome.NOT_FOUND,
          http_status: 404,
        });
        expect(ibamaTempDirectories()).toEqual(before);
      });

      it('500: UNAVAILABLE, registrado como FAILURE, sem pasta temporária sobrando', async () => {
        behavior[EMBARGO_PATH] = 'error';
        const before = ibamaTempDirectories();

        const result = await dataSource.download(
          IbamaResource.TERMO_EMBARGO,
          context,
        );

        expect(result).toMatchObject({
          status: 'UNAVAILABLE',
          reason: 'FAILURE',
          message: 'HTTP 500',
        });
        expect((await logs())[0]).toMatchObject({
          outcome: RequestOutcome.FAILURE,
          http_status: 500,
        });
        expect(ibamaTempDirectories()).toEqual(before);
      });

      it('tempo esgotado no meio do download: TIMEOUT, sem arquivo parcial', async () => {
        await prisma.dataSource.update({
          where: { slug: 'IBAMA' },
          data: { request_timeout_ms: 400 },
        });
        behavior[EMBARGO_PATH] = 'hang';
        const before = ibamaTempDirectories();

        const result = await dataSource.download(
          IbamaResource.TERMO_EMBARGO,
          context,
        );

        expect(result).toMatchObject({
          status: 'UNAVAILABLE',
          reason: 'TIMEOUT',
        });
        expect((await logs())[0].outcome).toBe(RequestOutcome.TIMEOUT);
        expect(ibamaTempDirectories()).toEqual(before);
      });

      it('fonte desabilitada no catálogo: não baixa nada, nem registra', async () => {
        await prisma.dataSource.update({
          where: { slug: 'IBAMA' },
          data: { is_enabled: false },
        });
        const before = ibamaTempDirectories();

        const result = await dataSource.download(
          IbamaResource.AUTO_INFRACAO,
          context,
        );

        expect(result).toEqual({ status: 'UNAVAILABLE', reason: 'DISABLED' });
        expect(requested).toHaveLength(0);
        expect(await logs()).toHaveLength(0);
        expect(ibamaTempDirectories()).toEqual(before);
      });
    });

    describe('o dump baixado não tem o formato esperado', () => {
      it('.zip cortado ao meio: o download conclui, e a leitura falha como erro do dump', async () => {
        behavior[AUTO_PATH] = 'truncated';
        const dump = await open(IbamaResource.AUTO_INFRACAO);

        await expect(collect(dump)).rejects.toBeInstanceOf(
          IbamaDumpFormatError,
        );
      });

      it('CSV sem a coluna do documento: a leitura falha, e nenhum registro sai', async () => {
        embargoCsv = toIbamaCsv(
          TERMO_EMBARGO_COLUMNS.filter(
            (column) => column !== 'CPF_CNPJ_EMBARGADO',
          ),
          [termoEmbargoRowFactory.build()],
        );
        const dump = await open(IbamaResource.TERMO_EMBARGO);
        const delivered: IbamaRecord[] = [];

        await expect(async () => {
          for await (const record of dump.records()) delivered.push(record);
        }).rejects.toBeInstanceOf(IbamaDumpFormatError);

        expect(delivered).toHaveLength(0);
      });
    });

    describe('arquivos temporários', () => {
      it('dispose apaga a pasta do dump', async () => {
        const before = ibamaTempDirectories();
        const result = await dataSource.download(
          IbamaResource.TERMO_EMBARGO,
          context,
        );
        if (result.status !== 'FOUND') throw new Error('dump não baixado');

        expect(ibamaTempDirectories()).toHaveLength(before.length + 1);

        await result.data.dispose();

        expect(ibamaTempDirectories()).toEqual(before);
      });
    });
  },
);

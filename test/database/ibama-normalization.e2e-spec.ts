import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import { RequestTrigger } from '@prisma/client';
import { CATALOG_SEEDERS } from '@app/database/catalog.seeders.js';
import { IbamaResource } from '@modules/ibama/domain/ibama-resource.js';
import { IBAMA_RESOURCES } from '@modules/ibama/domain/ibama-resource.js';
import { IbamaDataSource } from '@modules/ibama/infra/providers/ibama.data-source.js';
import { NormalizeIbamaRecordsUseCase } from '@modules/ibama/infra/usecases/normalize-ibama-records.usecase.js';
import { OpenEvidenceBatchUseCase } from '@modules/evidences/infra/usecases/open-evidence-batch.usecase.js';
import { ListCompanyEvidencesUseCase } from '@modules/evidences/infra/usecases/list-company-evidences.usecase.js';
import { RecordEvidenceCollectionUseCase } from '@modules/evidences/infra/usecases/record-evidence-collection.usecase.js';
import { PrismaService } from '@shared/infra/database/prisma.service.js';
import { inject } from 'vitest';
import {
  AUTO_INFRACAO_COLUMNS,
  autoInfracaoRowFactory,
  type IbamaCsvRow,
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

const REDIS_URL = inject('testRedisUrl');
const AUTO_PATH = `/${IBAMA_RESOURCES.AUTO_INFRACAO.segments.join('/')}`;
const EMBARGO_PATH = `/${IBAMA_RESOURCES.TERMO_EMBARGO.segments.join('/')}`;
const DAY_MS = 86_400_000;
const TTL_MS = 2 * DAY_MS;

/**
 * Normalização das evidências do IBAMA ponta a ponta (UC14, RF08): o dump
 * baixado por `IbamaDataSource` de um servidor local, normalizado e gravado em
 * `evidence_raw` e `evidence_normalized` no MongoDB real, pela carga em lote.
 */
describe.runIf(inject('databaseAvailable') && inject('redisAvailable'))(
  'Normalização das evidências do IBAMA (e2e)',
  () => {
    let app: INestApplication;
    let prisma: PrismaService;
    let dataSource: IbamaDataSource;
    let normalize: NormalizeIbamaRecordsUseCase;
    let openBatch: OpenEvidenceBatchUseCase;
    let listEvidences: ListCompanyEvidencesUseCase;
    let recordCollection: RecordEvidenceCollectionUseCase;
    let server: Server;
    let baseUrl: string;
    let autoRows: IbamaCsvRow[];
    let embargoRows: IbamaCsvRow[];
    let embargoFails = false;
    let sourceId: string;
    let runSequence = 0;

    function autoRow(over: IbamaCsvRow = {}) {
      return autoInfracaoRowFactory.build({
        DES_AUTO_INFRACAO: 'texto',
        ...over,
      });
    }

    function embargoRow(over: IbamaCsvRow = {}) {
      return termoEmbargoRowFactory.build({ DES_TAD: 'texto', ...over });
    }

    beforeAll(async () => {
      ({ app, prisma } = await createDatabaseTestingApp());
      dataSource = app.get(IbamaDataSource, { strict: false });
      normalize = app.get(NormalizeIbamaRecordsUseCase, { strict: false });
      openBatch = app.get(OpenEvidenceBatchUseCase, { strict: false });
      listEvidences = app.get(ListCompanyEvidencesUseCase, { strict: false });
      recordCollection = app.get(RecordEvidenceCollectionUseCase, {
        strict: false,
      });
      server = createServer((request, response) => {
        if (request.url === AUTO_PATH) {
          response.writeHead(200).end(
            buildZip([
              {
                name: 'auto_infracao_2024.csv',
                content: toIbamaCsv(AUTO_INFRACAO_COLUMNS, autoRows),
              },
            ]),
          );
        } else if (request.url === EMBARGO_PATH && !embargoFails) {
          response.writeHead(200).end(
            toIbamaCsv(TERMO_EMBARGO_COLUMNS, embargoRows, {
              quoteAll: true,
              bom: true,
            }),
          );
        } else {
          response.writeHead(500).end('erro');
        }
      });
      await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve),
      );
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });

    beforeEach(async () => {
      embargoFails = false;
      autoRows = [];
      embargoRows = [];
      await prisma.reset([
        'data_sources',
        'data_source_request_logs',
        'evidence_raw',
        'evidence_normalized',
        'ingestion_runs',
      ]);
      await prisma.seed(CATALOG_SEEDERS);
      await prisma.dataSource.update({
        where: { slug: 'IBAMA' },
        data: { base_url: baseUrl },
      });
      sourceId = (
        await prisma.dataSource.findUniqueOrThrow({ where: { slug: 'IBAMA' } })
      ).id_data_source;
      await resetSourceRateLimits(REDIS_URL);
    });

    afterAll(async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await prisma.reset([
        'data_sources',
        'data_source_request_logs',
        'evidence_raw',
        'evidence_normalized',
        'ingestion_runs',
      ]);
      await resetSourceRateLimits(REDIS_URL);
      await app.close();
    });

    /**
     * Uma execução completa do IBAMA, como o job a fará: abre a carga, baixa e
     * normaliza os dois dumps e, se tudo deu certo, encerra a carga.
     */
    async function ingest(
      collectedAt: Date,
      { finish = true }: { finish?: boolean } = {},
    ) {
      runSequence += 1;
      const run = await prisma.ingestionRun.create({
        data: {
          data_source_id: sourceId,
          run_type: 'SCHEDULED',
          job_id: `run-${runSequence}`,
        },
      });
      const batch = await openBatch.execute({
        sourceSlug: 'IBAMA',
        collectedAt,
        ingestionRunId: run.id_ingestion_run,
      });
      const context = { trigger: RequestTrigger.SCHEDULED_JOB };
      const results = [];

      for (const resource of [
        IbamaResource.AUTO_INFRACAO,
        IbamaResource.TERMO_EMBARGO,
      ]) {
        const downloaded = await dataSource.download(resource, context);

        if (downloaded.status !== 'FOUND') {
          throw new Error(`dump ${resource} indisponível`);
        }

        try {
          results.push(
            await normalize.execute({
              records: downloaded.data.records(),
              batch,
            }),
          );
        } finally {
          await downloaded.data.dispose();
        }
      }

      const removed = finish ? (await batch.finish()).removed : null;

      return { results, removed, runId: run.id_ingestion_run };
    }

    const evidences = (cnpj = IBAMA_CNPJ) =>
      prisma.evidenceNormalized.findMany({
        where: { cnpj },
        orderBy: { evidence_key: 'asc' },
      });

    describe('evidência normalizada', () => {
      it('grava o auto de infração com fonte, categoria, ODS, estado, datas e referência', async () => {
        autoRows = [
          autoRow({
            SEQ_AUTO_INFRACAO: '691556',
            NUM_AUTO_INFRACAO: '1092',
            SER_AUTO_INFRACAO: 'A',
            TIPO_AUTO: 'Multa simples',
            DES_INFRACAO: 'Destruir floresta',
            VAL_AUTO_INFRACAO: '6932,00',
            DAT_HORA_AUTO_INFRACAO: '2024-05-17 10:30:00',
            MUNICIPIO: 'Altamira',
            UF: 'PA',
          }),
        ];
        const collectedAt = new Date();
        const ods15 = await prisma.ods.findUniqueOrThrow({
          where: { ods_number: 15 },
        });

        await ingest(collectedAt);

        const [stored] = await evidences();
        expect(stored).toMatchObject({
          evidence_key: `IBAMA:${IBAMA_CNPJ}:AI-691556`,
          cnpj: IBAMA_CNPJ,
          data_source_id: sourceId,
          ods_id: ods15.id_ods,
          category: 'INFRACAO_AMBIENTAL',
          state: 'CONFIRMED',
          signal: 'NEGATIVE',
          summary:
            'Multa simples: Destruir floresta — R$ 6.932,00 (Altamira/PA)',
          source_reference: '1092-A',
          source_url:
            'https://dadosabertos.ibama.gov.br/dataset/fiscalizacao-auto-de-infracao',
          published_at: new Date('2024-05-17T00:00:00.000Z'),
        });
        expect(stored.collected_at).toEqual(collectedAt);
        expect(stored.valid_until).toEqual(
          new Date(collectedAt.getTime() + TTL_MS),
        );
        expect(stored.details).toMatchObject({
          resource: 'AUTO_INFRACAO',
          fine_amount: 6932,
          uf: 'PA',
        });
      });

      it('grava o termo de embargo, inclusive o desembargado, e os dois recursos convivem', async () => {
        autoRows = [autoRow({ SEQ_AUTO_INFRACAO: '5' })];
        embargoRows = [
          embargoRow({
            SEQ_TAD: '5',
            NUM_TAD: 'AAAA1111',
            SER_TAD: '',
            SIT_DESEMBARGO: 'S',
            DAT_DESEMBARGO: '2024-03-01 10:00:00',
          }),
        ];

        await ingest(new Date());

        // O mesmo identificador interno (5) nos dois recursos não colide.
        const stored = await evidences();
        expect(stored.map(({ evidence_key }) => evidence_key)).toEqual([
          `IBAMA:${IBAMA_CNPJ}:AI-5`,
          `IBAMA:${IBAMA_CNPJ}:TE-5`,
        ]);
        const embargo = stored[1];
        expect(embargo.source_reference).toBe('AAAA1111');
        expect(embargo.summary).toMatch(/desembargado em 01\/03\/2024$/);
        expect(embargo.details).toMatchObject({ lifted: true });
      });

      it('lista as evidências da empresa já com o estado de agora', async () => {
        autoRows = [autoRow()];
        await ingest(new Date());

        const listed = await listEvidences.execute(IBAMA_CNPJ);

        expect(listed).toHaveLength(1);
        expect(listed[0]).toMatchObject({
          sourceSlug: 'IBAMA',
          odsNumber: 15,
          state: 'CONFIRMED',
          signal: 'NEGATIVE',
        });
      });

      it('o número público repetido em registros diferentes são evidências diferentes', async () => {
        autoRows = [
          autoRow({ SEQ_AUTO_INFRACAO: '1', NUM_AUTO_INFRACAO: '9185894' }),
          autoRow({ SEQ_AUTO_INFRACAO: '2', NUM_AUTO_INFRACAO: '9185894' }),
        ];

        await ingest(new Date());

        const stored = await evidences();
        expect(stored).toHaveLength(2);
        expect(
          new Set(stored.map(({ source_reference }) => source_reference)),
        ).toEqual(new Set(['9185894-E']));
      });

      it('o mesmo registro duas vezes no dump é uma evidência só', async () => {
        const row = autoRow({ SEQ_AUTO_INFRACAO: '7' });
        autoRows = [row, row];

        await ingest(new Date());

        expect(await evidences()).toHaveLength(1);
      });

      it('separa as empresas pelo CNPJ', async () => {
        autoRows = [
          autoRow({ SEQ_AUTO_INFRACAO: '1' }),
          autoRow({
            SEQ_AUTO_INFRACAO: '2',
            CPF_CNPJ_INFRATOR: IBAMA_OTHER_CNPJ,
          }),
        ];

        await ingest(new Date());

        expect(await evidences(IBAMA_CNPJ)).toHaveLength(1);
        expect(await evidences(IBAMA_OTHER_CNPJ)).toHaveLength(1);
      });
    });

    describe('pessoa física e registros anulados', () => {
      it('nenhum CPF chega ao banco, nem na evidência nem no registro bruto', async () => {
        autoRows = [
          autoRow({ SEQ_AUTO_INFRACAO: '1' }),
          autoRow({
            SEQ_AUTO_INFRACAO: '2',
            TP_PESSOA_INFRATOR: 'PF',
            CPF_CNPJ_INFRATOR: IBAMA_CPF_MASKED,
            NOME_INFRATOR: 'NOME SECRETO DA PESSOA',
          }),
          autoRow({
            SEQ_AUTO_INFRACAO: '3',
            TP_PESSOA_INFRATOR: 'PJ',
            CPF_CNPJ_INFRATOR: IBAMA_CPF,
          }),
        ];
        embargoRows = [
          embargoRow({ SEQ_TAD: '1' }),
          embargoRow({ SEQ_TAD: '2', CPF_CNPJ_EMBARGADO: IBAMA_CPF }),
        ];

        await ingest(new Date());

        const stored = JSON.stringify([
          await prisma.evidenceNormalized.findMany(),
          await prisma.evidenceRaw.findMany(),
        ]);
        expect(stored).not.toContain(IBAMA_CPF);
        expect(stored).not.toContain('123.456.789');
        expect(stored).not.toContain('NOME SECRETO');
        expect(await prisma.evidenceNormalized.count()).toBe(2);
        expect(await prisma.evidenceRaw.count()).toBe(2);
      });

      it('o registro bruto não tem o nome do autuado, o texto livre nem a geometria', async () => {
        autoRows = [
          autoRow({ SEQ_AUTO_INFRACAO: '1', DES_AUTO_INFRACAO: 'texto livre' }),
        ];

        await ingest(new Date());

        const [raw] = await prisma.evidenceRaw.findMany();
        const payload = JSON.stringify(raw.payload);
        expect(payload).not.toContain('NOME_INFRATOR');
        expect(payload).not.toContain('DES_AUTO_INFRACAO');
        expect(payload).not.toContain('POLYGON');
      });

      it.each([
        ['cancelado', { SIT_CANCELADO: 'S' }],
        ['excluído', { DES_STATUS_FORMULARIO: 'Excluído' }],
        ['substituído', { DES_STATUS_FORMULARIO: 'Substituído por outro' }],
      ])('o auto %s não vira evidência', async (_nome, over) => {
        autoRows = [autoRow({ SEQ_AUTO_INFRACAO: '1', ...over })];

        const { results } = await ingest(new Date());

        expect(await evidences()).toHaveLength(0);
        expect(await prisma.evidenceRaw.count()).toBe(0);
        expect(results[0]).toMatchObject({ annulled: 1, written: 0 });
      });

      it('o auto que passa a ser cancelado deixa de ser evidência na carga seguinte', async () => {
        autoRows = [autoRow({ SEQ_AUTO_INFRACAO: '1' })];
        await ingest(new Date(Date.now() - DAY_MS));
        expect(await evidences()).toHaveLength(1);

        autoRows = [autoRow({ SEQ_AUTO_INFRACAO: '1', SIT_CANCELADO: 'S' })];
        await ingest(new Date());

        expect(await evidences()).toHaveLength(0);
      });
    });

    describe('registro bruto (auditoria)', () => {
      it('a evidência aponta para o registro bruto, que fica ligado à execução e à fonte', async () => {
        autoRows = [
          autoRow({ SEQ_AUTO_INFRACAO: '1', NUM_AUTO_INFRACAO: '77' }),
        ];

        const { runId } = await ingest(new Date());

        const [evidence] = await evidences();
        const raw = await prisma.evidenceRaw.findUniqueOrThrow({
          where: { id_evidence_raw: evidence.evidence_raw_id ?? '' },
        });
        expect(raw).toMatchObject({
          data_source_id: sourceId,
          ingestion_run_id: runId,
          cnpj: IBAMA_CNPJ,
          external_reference: '77-E',
        });
        expect(raw.payload).toMatchObject({
          resource: 'AUTO_INFRACAO',
          payload: { NUM_AUTO_INFRACAO: '77' },
        });
        expect(raw.payload_hash).toMatch(/^[0-9a-f]{64}$/);
      });
    });

    describe('idempotência', () => {
      it('repetir a carga não duplica evidência nem registro bruto, e renova a validade', async () => {
        autoRows = [
          autoRow({ SEQ_AUTO_INFRACAO: '1' }),
          autoRow({ SEQ_AUTO_INFRACAO: '2' }),
        ];
        embargoRows = [embargoRow({ SEQ_TAD: '1' })];
        const first = new Date(Date.now() - 3_600_000);
        const second = new Date();

        const run1 = await ingest(first);
        const evidencesBefore = await prisma.evidenceNormalized.findMany({
          orderBy: { evidence_key: 'asc' },
        });
        const rawBefore = await prisma.evidenceRaw.findMany({
          orderBy: { payload_hash: 'asc' },
        });
        const run2 = await ingest(second);
        const evidencesAfter = await prisma.evidenceNormalized.findMany({
          orderBy: { evidence_key: 'asc' },
        });
        const rawAfter = await prisma.evidenceRaw.findMany({
          orderBy: { payload_hash: 'asc' },
        });

        expect(evidencesAfter.map((e) => e.id_evidence)).toEqual(
          evidencesBefore.map((e) => e.id_evidence),
        );
        expect(rawAfter.map((r) => r.id_evidence_raw)).toEqual(
          rawBefore.map((r) => r.id_evidence_raw),
        );
        expect(evidencesAfter).toHaveLength(3);
        expect(evidencesAfter[0].collected_at).toEqual(second);
        expect(evidencesAfter[0].valid_until).toEqual(
          new Date(second.getTime() + TTL_MS),
        );
        expect(evidencesAfter[0].created_at).toEqual(
          evidencesBefore[0].created_at,
        );
        // O registro bruto guarda a primeira coleta.
        expect(rawAfter.map((r) => r.ingestion_run_id)).toEqual(
          rawBefore.map(() => run1.runId),
        );
        expect(run2.removed).toBe(0);
      });

      it('o registro que mudou no IBAMA atualiza a evidência e guarda a nova versão bruta', async () => {
        autoRows = [
          autoRow({ SEQ_AUTO_INFRACAO: '1', VAL_AUTO_INFRACAO: '100,00' }),
        ];
        await ingest(new Date(Date.now() - 3_600_000));
        const [before] = await evidences();

        autoRows = [
          autoRow({ SEQ_AUTO_INFRACAO: '1', VAL_AUTO_INFRACAO: '250,00' }),
        ];
        await ingest(new Date());

        const [after] = await evidences();
        expect(after.id_evidence).toBe(before.id_evidence);
        expect(after.details).toMatchObject({ fine_amount: 250 });
        expect(after.summary).toContain('R$ 250,00');
        expect(after.evidence_raw_id).not.toBe(before.evidence_raw_id);
        expect(await prisma.evidenceRaw.count()).toBe(2);
      });
    });

    describe('encerramento da carga: o que o dump deixou de listar', () => {
      it('remove a evidência do registro que sumiu do dump, e só ela', async () => {
        autoRows = [
          autoRow({ SEQ_AUTO_INFRACAO: '1' }),
          autoRow({ SEQ_AUTO_INFRACAO: '2' }),
        ];
        await ingest(new Date(Date.now() - DAY_MS));

        autoRows = [autoRow({ SEQ_AUTO_INFRACAO: '2' })];
        const { removed } = await ingest(new Date());

        expect(removed).toBe(1);
        expect((await evidences()).map((e) => e.evidence_key)).toEqual([
          `IBAMA:${IBAMA_CNPJ}:AI-2`,
        ]);
      });

      it('remove a empresa que deixou de aparecer no dump', async () => {
        autoRows = [
          autoRow({
            SEQ_AUTO_INFRACAO: '1',
            CPF_CNPJ_INFRATOR: IBAMA_OTHER_CNPJ,
          }),
        ];
        await ingest(new Date(Date.now() - DAY_MS));

        autoRows = [autoRow({ SEQ_AUTO_INFRACAO: '2' })];
        await ingest(new Date());

        expect(await evidences(IBAMA_OTHER_CNPJ)).toHaveLength(0);
        expect(await evidences(IBAMA_CNPJ)).toHaveLength(1);
      });

      it('um "não encontrado" antigo some quando o dump passa a ter registro da empresa', async () => {
        await recordCollection.execute({
          cnpj: IBAMA_CNPJ,
          sourceSlug: 'IBAMA',
          collectedAt: new Date(Date.now() - DAY_MS),
          result: { status: 'COLLECTED', findings: [] },
        });
        expect((await evidences()).map((e) => e.state)).toEqual(['NOT_FOUND']);

        autoRows = [autoRow({ SEQ_AUTO_INFRACAO: '1' })];
        await ingest(new Date());

        expect((await evidences()).map((e) => e.state)).toEqual(['CONFIRMED']);
      });

      it('não mexe nas evidências de outra fonte', async () => {
        await recordCollection.execute({
          cnpj: IBAMA_CNPJ,
          sourceSlug: 'CGU_CEIS',
          collectedAt: new Date(Date.now() - 10 * DAY_MS),
          result: { status: 'COLLECTED', findings: [{ reference: 'S-1' }] },
        });
        autoRows = [autoRow({ SEQ_AUTO_INFRACAO: '1' })];

        await ingest(new Date());

        const keys = (await evidences()).map((e) => e.evidence_key);
        expect(keys).toContain(`CGU_CEIS:${IBAMA_CNPJ}:S-1`);
        expect(keys).toContain(`IBAMA:${IBAMA_CNPJ}:AI-1`);
      });

      it('carga que falha no meio, sem encerrar, não remove nada', async () => {
        autoRows = [
          autoRow({ SEQ_AUTO_INFRACAO: '1' }),
          autoRow({ SEQ_AUTO_INFRACAO: '2' }),
        ];
        embargoRows = [embargoRow({ SEQ_TAD: '1' })];
        await ingest(new Date(Date.now() - DAY_MS));

        embargoFails = true;
        autoRows = [autoRow({ SEQ_AUTO_INFRACAO: '2' })];
        await expect(ingest(new Date())).rejects.toThrow(
          'dump TERMO_EMBARGO indisponível',
        );

        // As evidências anteriores seguem lá (envelhecem pela validade).
        expect(await evidences()).toHaveLength(3);
      });
    });

    describe('volume', () => {
      it('grava milhares de registros em fluxo, e a contagem fecha', async () => {
        autoRows = Array.from({ length: 3_000 }, (_, index) => {
          const row = autoRow({ SEQ_AUTO_INFRACAO: String(index + 1) });
          if (index % 3 === 0) {
            row.TP_PESSOA_INFRATOR = 'PF';
            row.CPF_CNPJ_INFRATOR = IBAMA_CPF_MASKED;
          } else if (index % 3 === 1) {
            row.SIT_CANCELADO = 'S';
          }

          return row;
        });

        const { results } = await ingest(new Date());

        expect(results[0]).toMatchObject({ read: 2_000, annulled: 1_000 });
        expect(await prisma.evidenceNormalized.count()).toBe(1_000);
        expect(await prisma.evidenceRaw.count()).toBe(1_000);
      }, 60_000);
    });
  },
);

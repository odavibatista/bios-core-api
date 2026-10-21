import type { INestApplication } from '@nestjs/common';
import { CATALOG_SEEDERS } from '@app/database/catalog.seeders.js';
import { EvidenceSourceNotFoundError } from '@modules/evidences/domain/dtos/errors/evidence.errors.js';
import { ListCompanyEvidencesUseCase } from '@modules/evidences/infra/usecases/list-company-evidences.usecase.js';
import { RecordEvidenceCollectionUseCase } from '@modules/evidences/infra/usecases/record-evidence-collection.usecase.js';
import { PrismaService } from '@shared/infra/database/prisma.service.js';
import { inject } from 'vitest';
import { createDatabaseTestingApp } from '../support/database-testing-app.js';

const CNPJ = '11222333000181';
const OTHER_CNPJ = '00000000000191';
const DAY_MS = 86_400_000;
const TTL_SECONDS = 2 * 86_400;

/**
 * Modelo de evidência ponta a ponta (RF08): gravação idempotente, retrato por
 * empresa e fonte, estados e validade, contra o MongoDB real e o catálogo de
 * fontes semeado. Cobre o que os mocks não pegam: o índice único da chave, o
 * `upsert`, o `notIn` e a gravação de campos ausentes.
 */
describe.runIf(inject('databaseAvailable') && inject('redisAvailable'))(
  'Modelo de evidência (e2e)',
  () => {
    let app: INestApplication;
    let prisma: PrismaService;
    let record: RecordEvidenceCollectionUseCase;
    let list: ListCompanyEvidencesUseCase;

    function rows(cnpj = CNPJ) {
      return prisma.evidenceNormalized.findMany({
        where: { cnpj },
        orderBy: { evidence_key: 'asc' },
      });
    }

    beforeAll(async () => {
      ({ app, prisma } = await createDatabaseTestingApp());
      record = app.get(RecordEvidenceCollectionUseCase, { strict: false });
      list = app.get(ListCompanyEvidencesUseCase, { strict: false });
      await prisma.seed(CATALOG_SEEDERS);
      // O seed não altera fontes existentes; a validade das evidências do
      // IBAMA é fixada aqui para o teste não depender do banco de cada um.
      await prisma.dataSource.update({
        where: { slug: 'IBAMA' },
        data: { cache_ttl_seconds: TTL_SECONDS },
      });
    });

    afterEach(async () => {
      await prisma.reset(['evidence_normalized']);
    });

    afterAll(async () => {
      await app.close();
    });

    describe('gravação', () => {
      it('grava a evidência com a categoria, o ODS e a validade do catálogo', async () => {
        const collectedAt = new Date();
        const ods15 = await prisma.ods.findUniqueOrThrow({
          where: { ods_number: 15 },
        });

        const output = await record.execute({
          cnpj: CNPJ,
          sourceSlug: 'IBAMA',
          collectedAt,
          result: {
            status: 'COLLECTED',
            findings: [
              {
                reference: 'AI-100',
                summary: 'Multa por desmatamento',
                url: 'https://dados.example/ai-100',
                details: { valor: 12_345, itens: ['a', 'b'] },
                publishedAt: new Date('2025-03-01T00:00:00.000Z'),
              },
            ],
          },
        });

        expect(output).toEqual({ saved: 1, removed: 0 });
        const [stored] = await rows();
        expect(stored).toMatchObject({
          evidence_key: `IBAMA:${CNPJ}:AI-100`,
          cnpj: CNPJ,
          ods_id: ods15.id_ods,
          category: 'INFRACAO_AMBIENTAL',
          state: 'CONFIRMED',
          signal: 'NEGATIVE',
          summary: 'Multa por desmatamento',
          source_reference: 'AI-100',
          source_url: 'https://dados.example/ai-100',
          details: { valor: 12_345, itens: ['a', 'b'] },
          published_at: new Date('2025-03-01T00:00:00.000Z'),
        });
        expect(stored.collected_at).toEqual(collectedAt);
        expect(stored.valid_until).toEqual(
          new Date(collectedAt.getTime() + TTL_SECONDS * 1_000),
        );
      });

      it('o sinal e o ODS de uma fonte positiva (GHG) vêm do catálogo', async () => {
        await record.execute({
          cnpj: CNPJ,
          sourceSlug: 'GHG_PROTOCOL',
          result: { status: 'COLLECTED', findings: [{ reference: '2024' }] },
        });

        const [stored] = await rows();
        const ods13 = await prisma.ods.findUniqueOrThrow({
          where: { ods_number: 13 },
        });
        expect(stored).toMatchObject({
          category: 'EMISSAO_GEE',
          signal: 'POSITIVE',
          ods_id: ods13.id_ods,
        });
      });

      it('recusa a fonte que não é de evidências, sem gravar', async () => {
        await expect(
          record.execute({
            cnpj: CNPJ,
            sourceSlug: 'BRASIL_API',
            result: { status: 'COLLECTED', findings: [] },
          }),
        ).rejects.toBeInstanceOf(EvidenceSourceNotFoundError);
        await expect(
          record.execute({
            cnpj: CNPJ,
            sourceSlug: 'NAO_EXISTE',
            result: { status: 'COLLECTED', findings: [] },
          }),
        ).rejects.toBeInstanceOf(EvidenceSourceNotFoundError);

        expect(await rows()).toHaveLength(0);
      });
    });

    describe('idempotência', () => {
      const findings = [
        { reference: 'AI-1', summary: 'Primeira' },
        { reference: 'AI-2', summary: 'Segunda' },
      ];

      it('repetir a mesma coleta não duplica nada e preserva a criação', async () => {
        const first = new Date('2026-10-01T00:00:00.000Z');
        const second = new Date('2026-10-02T00:00:00.000Z');

        await record.execute({
          cnpj: CNPJ,
          sourceSlug: 'IBAMA',
          collectedAt: first,
          result: { status: 'COLLECTED', findings },
        });
        const before = await rows();
        const output = await record.execute({
          cnpj: CNPJ,
          sourceSlug: 'IBAMA',
          collectedAt: second,
          result: { status: 'COLLECTED', findings },
        });
        const after = await rows();

        expect(output).toEqual({ saved: 2, removed: 0 });
        expect(after).toHaveLength(2);
        expect(after.map(({ id_evidence }) => id_evidence)).toEqual(
          before.map(({ id_evidence }) => id_evidence),
        );
        expect(after.map(({ created_at }) => created_at)).toEqual(
          before.map(({ created_at }) => created_at),
        );
        // A coleta nova renova a data e a validade.
        expect(after[0].collected_at).toEqual(second);
        expect(after[0].valid_until).toEqual(
          new Date(second.getTime() + TTL_SECONDS * 1_000),
        );
      });

      it('atualiza o que mudou e limpa o que a fonte deixou de informar', async () => {
        await record.execute({
          cnpj: CNPJ,
          sourceSlug: 'IBAMA',
          result: {
            status: 'COLLECTED',
            findings: [
              {
                reference: 'AI-1',
                summary: 'Antes',
                url: 'https://dados.example/antes',
                details: { valor: 1 },
                publishedAt: new Date('2025-01-01T00:00:00.000Z'),
              },
            ],
          },
        });

        await record.execute({
          cnpj: CNPJ,
          sourceSlug: 'IBAMA',
          result: {
            status: 'COLLECTED',
            findings: [{ reference: 'AI-1', summary: 'Depois' }],
          },
        });

        const [stored] = await rows();
        expect(stored.summary).toBe('Depois');
        expect(stored.source_url ?? null).toBeNull();
        expect(stored.details ?? null).toBeNull();
        expect(stored.published_at ?? null).toBeNull();
      });

      it('gravações simultâneas da mesma coleta resultam em uma evidência só', async () => {
        const attempts = Array.from({ length: 6 }, () =>
          record.execute({
            cnpj: CNPJ,
            sourceSlug: 'IBAMA',
            result: { status: 'COLLECTED', findings },
          }),
        );

        await expect(Promise.all(attempts)).resolves.toBeDefined();

        expect(await rows()).toHaveLength(2);
      });
    });

    describe('retrato da fonte para a empresa', () => {
      async function collect(...references: string[]) {
        return record.execute({
          cnpj: CNPJ,
          sourceSlug: 'IBAMA',
          result: {
            status: 'COLLECTED',
            findings: references.map((reference) => ({ reference })),
          },
        });
      }

      it('o que a fonte deixou de listar é removido', async () => {
        await collect('AI-1', 'AI-2', 'AI-3');

        const output = await collect('AI-2');

        expect(output).toEqual({ saved: 1, removed: 2 });
        expect((await rows()).map(({ evidence_key }) => evidence_key)).toEqual([
          `IBAMA:${CNPJ}:AI-2`,
        ]);
      });

      it('sem registro na fonte, grava NOT_FOUND no lugar das evidências', async () => {
        await collect('AI-1');

        await collect();

        const stored = await rows();
        expect(stored).toHaveLength(1);
        expect(stored[0]).toMatchObject({
          evidence_key: `IBAMA:${CNPJ}#NOT_FOUND`,
          state: 'NOT_FOUND',
          category: 'INFRACAO_AMBIENTAL',
        });
        expect(stored[0].source_reference ?? null).toBeNull();
      });

      it('um registro novo substitui o NOT_FOUND', async () => {
        await collect();

        await collect('AI-1');

        const stored = await rows();
        expect(stored.map(({ state }) => state)).toEqual(['CONFIRMED']);
      });

      it('não mexe em outra empresa nem em outra fonte', async () => {
        await collect('AI-1');
        await record.execute({
          cnpj: OTHER_CNPJ,
          sourceSlug: 'IBAMA',
          result: { status: 'COLLECTED', findings: [{ reference: 'AI-9' }] },
        });
        await record.execute({
          cnpj: CNPJ,
          sourceSlug: 'CGU_CEIS',
          result: { status: 'COLLECTED', findings: [{ reference: 'S-1' }] },
        });

        await collect();

        expect(
          (await rows()).map(({ evidence_key }) => evidence_key).sort(),
        ).toEqual([`CGU_CEIS:${CNPJ}:S-1`, `IBAMA:${CNPJ}#NOT_FOUND`].sort());
        expect((await rows(OTHER_CNPJ)).map((row) => row.state)).toEqual([
          'CONFIRMED',
        ]);
      });

      it('a mesma referência em duas empresas são duas evidências', async () => {
        for (const cnpj of [CNPJ, OTHER_CNPJ]) {
          await record.execute({
            cnpj,
            sourceSlug: 'IBAMA',
            result: { status: 'COLLECTED', findings: [{ reference: 'AI-1' }] },
          });
        }

        expect(await rows()).toHaveLength(1);
        expect(await rows(OTHER_CNPJ)).toHaveLength(1);
      });
    });

    describe('fonte indisponível (UNKNOWN)', () => {
      const unavailable = {
        cnpj: CNPJ,
        sourceSlug: 'IBAMA',
        result: { status: 'UNAVAILABLE' as const },
      };

      it('sem coleta anterior, grava UNKNOWN, que vale pouco tempo', async () => {
        const collectedAt = new Date();

        await record.execute({ ...unavailable, collectedAt });

        const [stored] = await rows();
        expect(stored).toMatchObject({
          evidence_key: `IBAMA:${CNPJ}#UNKNOWN`,
          state: 'UNKNOWN',
        });
        expect(stored.valid_until.getTime() - collectedAt.getTime()).toBe(
          15 * 60 * 1_000,
        );
      });

      it('repetir a indisponibilidade não duplica o UNKNOWN', async () => {
        await record.execute(unavailable);
        await record.execute(unavailable);

        expect(await rows()).toHaveLength(1);
      });

      it('com evidência anterior, a falha da fonte não apaga nada', async () => {
        await record.execute({
          cnpj: CNPJ,
          sourceSlug: 'IBAMA',
          result: { status: 'COLLECTED', findings: [{ reference: 'AI-1' }] },
        });
        const before = await rows();

        const output = await record.execute(unavailable);

        expect(output).toEqual({ saved: 0, removed: 0 });
        expect(await rows()).toEqual(before);
      });

      it('com NOT_FOUND anterior, também o mantém', async () => {
        await record.execute({
          cnpj: CNPJ,
          sourceSlug: 'IBAMA',
          result: { status: 'COLLECTED', findings: [] },
        });

        await record.execute(unavailable);

        expect((await rows()).map(({ state }) => state)).toEqual(['NOT_FOUND']);
      });

      it('a coleta que responde depois substitui o UNKNOWN', async () => {
        await record.execute(unavailable);

        await record.execute({
          cnpj: CNPJ,
          sourceSlug: 'IBAMA',
          result: { status: 'COLLECTED', findings: [{ reference: 'AI-1' }] },
        });

        expect((await rows()).map(({ state }) => state)).toEqual(['CONFIRMED']);
      });
    });

    describe('listagem e validade', () => {
      it('empresa sem evidências: lista vazia (nenhuma fonte foi consultada)', async () => {
        await expect(list.execute(CNPJ)).resolves.toEqual([]);
      });

      it('traz a fonte, o ODS e o estado vigente', async () => {
        await record.execute({
          cnpj: CNPJ,
          sourceSlug: 'IBAMA',
          result: {
            status: 'COLLECTED',
            findings: [{ reference: 'AI-1', summary: 'Multa' }],
          },
        });
        await record.execute({
          cnpj: CNPJ,
          sourceSlug: 'GHG_PROTOCOL',
          result: { status: 'UNAVAILABLE' },
        });

        const evidences = await list.execute(CNPJ);

        expect(
          evidences
            .map(({ sourceSlug, odsNumber, state, signal }) => ({
              sourceSlug,
              odsNumber,
              state,
              signal,
            }))
            .sort((a, b) => a.sourceSlug.localeCompare(b.sourceSlug)),
        ).toEqual([
          {
            sourceSlug: 'GHG_PROTOCOL',
            odsNumber: 13,
            state: 'UNKNOWN',
            signal: 'POSITIVE',
          },
          {
            sourceSlug: 'IBAMA',
            odsNumber: 15,
            state: 'CONFIRMED',
            signal: 'NEGATIVE',
          },
        ]);
      });

      it('passada a validade, a evidência volta como OUTDATED; o banco guarda o estado da coleta', async () => {
        await record.execute({
          cnpj: CNPJ,
          sourceSlug: 'IBAMA',
          collectedAt: new Date(Date.now() - 3 * DAY_MS),
          result: { status: 'COLLECTED', findings: [{ reference: 'AI-1' }] },
        });
        await record.execute({
          cnpj: CNPJ,
          sourceSlug: 'CGU_CEIS',
          collectedAt: new Date(),
          result: { status: 'COLLECTED', findings: [] },
        });

        const evidences = await list.execute(CNPJ);

        expect(
          Object.fromEntries(
            evidences.map(({ sourceSlug, state }) => [sourceSlug, state]),
          ),
        ).toEqual({ IBAMA: 'OUTDATED', CGU_CEIS: 'NOT_FOUND' });
        const stored = await prisma.evidenceNormalized.findFirstOrThrow({
          where: { cnpj: CNPJ, evidence_key: `IBAMA:${CNPJ}:AI-1` },
        });
        expect(stored.state).toBe('CONFIRMED');
      });

      it('uma nova coleta devolve a evidência vencida a CONFIRMED', async () => {
        const findings = [{ reference: 'AI-1' }];
        await record.execute({
          cnpj: CNPJ,
          sourceSlug: 'IBAMA',
          collectedAt: new Date(Date.now() - 3 * DAY_MS),
          result: { status: 'COLLECTED', findings },
        });
        expect((await list.execute(CNPJ))[0].state).toBe('OUTDATED');

        await record.execute({
          cnpj: CNPJ,
          sourceSlug: 'IBAMA',
          result: { status: 'COLLECTED', findings },
        });

        expect((await list.execute(CNPJ))[0].state).toBe('CONFIRMED');
      });
    });
  },
);

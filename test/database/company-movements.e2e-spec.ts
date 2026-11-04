import type { INestApplication } from '@nestjs/common';
import { CATALOG_SEEDERS } from '@app/database/catalog.seeders.js';
import { RecordEvidenceCollectionUseCase } from '@modules/evidences/infra/usecases/record-evidence-collection.usecase.js';
import { IBAMA_DATASET_URLS } from '@modules/ibama/domain/ibama-evidence.mapper.js';
import { CalculateCompanyOdsScoresUseCase } from '@modules/scoring/infra/usecases/calculate-company-ods-scores.usecase.js';
import { PrismaService } from '@shared/infra/database/prisma.service.js';
import { inject } from 'vitest';
import { companyProfileResponseFactory } from '../factories/companies/company-profile.factory.js';
import { createDatabaseTestingApp } from '../support/database-testing-app.js';

const CNPJ = '11222333000181';
const collections = [
  'company_movements',
  'company_ods_scores',
  'evidence_normalized',
  'evidence_raw',
  'evidence_collection_clocks',
  'company_profile',
  'data_sources',
  'ods',
];

/** UC15, passo 6 (RF33), contra o MongoDB real: a transação é o que mocks não provam. */
describe.runIf(inject('databaseAvailable') && inject('redisAvailable'))(
  'Movimentação do índice no recálculo (e2e)',
  () => {
    let app: INestApplication;
    let prisma: PrismaService;
    let record: RecordEvidenceCollectionUseCase;
    let calculate: CalculateCompanyOdsScoresUseCase;

    const infractions = (references: readonly string[]) =>
      record.execute({
        cnpj: CNPJ,
        sourceSlug: 'IBAMA',
        result: {
          status: 'COLLECTED',
          findings: references.map((reference) => ({
            reference,
            url: IBAMA_DATASET_URLS.AUTO_INFRACAO,
          })),
        },
      });
    const inventory = () =>
      record.execute({
        cnpj: CNPJ,
        sourceSlug: 'GHG_PROTOCOL',
        result: {
          status: 'COLLECTED',
          findings: [
            {
              reference: '5091/19',
              url: 'https://sistema-registropublicodeemissoesapi.fgv.br/GenerateReport/GenerateInventoryPDF/5091',
            },
          ],
        },
      });
    const saveProfile = async () => {
      const source = await prisma.dataSource.findUniqueOrThrow({
        where: { slug: 'BRASIL_API' },
      });
      const { refreshed_at, ...profile } = companyProfileResponseFactory.build({
        cnpj: CNPJ,
      });

      await prisma.companyProfile.create({
        data: {
          ...profile,
          refreshed_at: new Date(refreshed_at),
          content_hash: 'movimentacao-e2e',
          cadastral_source_id: source.id_data_source,
        },
      });
    };
    const movement = () =>
      prisma.companyMovement.findUnique({ where: { cnpj: CNPJ } });
    const odsMovement = async (odsNumber: number) =>
      (await movement())?.ods_movements.find(
        (item) => item.ods_number === odsNumber,
      );

    beforeAll(async () => {
      ({ app, prisma } = await createDatabaseTestingApp());
      record = app.get(RecordEvidenceCollectionUseCase, { strict: false });
      calculate = app.get(CalculateCompanyOdsScoresUseCase, { strict: false });
    });
    beforeEach(async () => {
      await prisma.reset(collections);
      await prisma.seed(CATALOG_SEEDERS);
    });
    afterAll(async () => {
      await prisma.reset(collections);
      await app.close();
    });

    it('primeiro índice de empresa com perfil é AVAILABLE, só no ODS que tem índice', async () => {
      await saveProfile();
      await infractions(['AI-001']);

      await calculate.execute(CNPJ);

      expect(await movement()).toMatchObject({
        ods_movements: [
          {
            ods_number: 15,
            direction: 'AVAILABLE',
            cause: 'EVIDENCE_ADDED',
            evidence_category: 'INFRACAO_AMBIENTAL',
          },
        ],
      });
    });

    it('nova infração desce o índice, e a retirada dela sobe', async () => {
      await saveProfile();
      await infractions(['AI-001']);
      await calculate.execute(CNPJ);

      await infractions(['AI-001', 'AI-002']);
      await calculate.execute(CNPJ);

      expect(await odsMovement(15)).toMatchObject({
        direction: 'DECREASED',
        cause: 'EVIDENCE_ADDED',
      });

      await infractions(['AI-001']);
      await calculate.execute(CNPJ);

      expect(await odsMovement(15)).toMatchObject({
        direction: 'INCREASED',
        cause: 'EVIDENCE_REMOVED',
      });
    });

    it('índice que deixa de existir é UNAVAILABLE', async () => {
      await saveProfile();
      await infractions(['AI-001']);
      await calculate.execute(CNPJ);

      await infractions([]);
      await calculate.execute(CNPJ);

      expect(await odsMovement(15)).toMatchObject({
        direction: 'UNAVAILABLE',
        cause: 'EVIDENCE_REMOVED',
      });
    });

    it('recálculo com o mesmo índice não mexe na movimentação', async () => {
      await saveProfile();
      await infractions(['AI-001']);
      await calculate.execute(CNPJ);
      const before = await movement();

      await calculate.execute(CNPJ);

      expect((await movement())?.moved_at).toEqual(before?.moved_at);
    });

    it('um ODS novo não apaga o outro, e moved_at acompanha o mais recente', async () => {
      await saveProfile();
      await infractions(['AI-001']);
      await calculate.execute(CNPJ);
      const first = await odsMovement(15);

      await inventory();
      await calculate.execute(CNPJ);

      const current = await movement();

      expect(current?.ods_movements.map((item) => item.ods_number)).toEqual([
        13, 15,
      ]);
      expect(await odsMovement(15)).toEqual(first);
      expect(current?.moved_at).toEqual((await odsMovement(13))?.moved_at);
      expect(current?.moved_at.getTime()).toBeGreaterThan(
        first!.moved_at.getTime(),
      );
    });

    it('mudança da versão das regras não é movimentação', async () => {
      await saveProfile();
      await infractions(['AI-001']);
      await calculate.execute(CNPJ);
      const before = await movement();

      await prisma.companyOdsScore.updateMany({
        where: { cnpj: CNPJ },
        data: { rules_version: 'versao-antiga' },
      });
      await infractions(['AI-001', 'AI-002']);
      await calculate.execute(CNPJ);

      expect(await movement()).toMatchObject({
        moved_at: before?.moved_at,
        ods_movements: before?.ods_movements,
      });
    });

    it('empresa sem perfil cadastral não ganha movimentação', async () => {
      await infractions(['AI-001']);

      await calculate.execute(CNPJ);

      expect(await movement()).toBeNull();
    });

    it('a coleção não guarda índice anterior nem variação (IND03)', async () => {
      await saveProfile();
      await infractions(['AI-001']);
      await calculate.execute(CNPJ);
      await infractions(['AI-001', 'AI-002']);
      await calculate.execute(CNPJ);

      const stored = JSON.stringify(await movement());

      expect(stored).not.toMatch(/score|points|value|previous/);
    });

    it('falha ao gravar a movimentação desfaz também os índices', async () => {
      await saveProfile();
      await infractions(['AI-001']);
      await calculate.execute(CNPJ);
      const score = () =>
        prisma.companyOdsScore.findFirst({
          where: { cnpj: CNPJ, ods_number: 15 },
        });
      const before = await score();

      // Um documento que o Prisma não consegue ler derruba a leitura dentro da transação.
      await prisma.$runCommandRaw({
        update: 'company_movements',
        updates: [
          {
            q: { cnpj: CNPJ },
            u: { $set: { 'ods_movements.0.direction': 'SENTIDO_INVALIDO' } },
          },
        ],
      });
      await infractions(['AI-001', 'AI-002']);

      await expect(calculate.execute(CNPJ)).rejects.toThrow();

      expect((await score())?.score_value).toBe(before?.score_value);
      expect((await score())?.calculated_at).toEqual(before?.calculated_at);
    });
  },
);

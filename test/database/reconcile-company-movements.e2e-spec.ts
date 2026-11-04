import type { INestApplication } from '@nestjs/common';
import { CATALOG_SEEDERS } from '@app/database/catalog.seeders.js';
import { RecordEvidenceCollectionUseCase } from '@modules/evidences/infra/usecases/record-evidence-collection.usecase.js';
import { IBAMA_DATASET_URLS } from '@modules/ibama/domain/ibama-evidence.mapper.js';
import { CompanyMovementRepository } from '@modules/scoring/domain/dtos/repositories/company-movement.repository.js';
import { CalculateCompanyOdsScoresUseCase } from '@modules/scoring/infra/usecases/calculate-company-ods-scores.usecase.js';
import { ReconcileCompanyMovementsUseCase } from '@modules/scoring/infra/usecases/reconcile-company-movements.usecase.js';
import { PrismaService } from '@shared/infra/database/prisma.service.js';
import { inject } from 'vitest';
import { companyProfileResponseFactory } from '../factories/companies/company-profile.factory.js';
import { createDatabaseTestingApp } from '../support/database-testing-app.js';

const CNPJ = '11222333000181';
const OTHER_CNPJ = '00000000000191';
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

/** UC15, regra 8 (RF33 c), contra o MongoDB real. */
describe.runIf(inject('databaseAvailable') && inject('redisAvailable'))(
  'Varredura das movimentações que faltam (e2e)',
  () => {
    let app: INestApplication;
    let prisma: PrismaService;
    let record: RecordEvidenceCollectionUseCase;
    let calculate: CalculateCompanyOdsScoresUseCase;
    let reconcile: ReconcileCompanyMovementsUseCase;
    let repository: CompanyMovementRepository;

    const infractions = (cnpj: string, references: readonly string[]) =>
      record.execute({
        cnpj,
        sourceSlug: 'IBAMA',
        result: {
          status: 'COLLECTED',
          findings: references.map((reference) => ({
            reference,
            url: IBAMA_DATASET_URLS.AUTO_INFRACAO,
          })),
        },
      });
    const saveProfile = async (cnpj: string) => {
      const source = await prisma.dataSource.findUniqueOrThrow({
        where: { slug: 'BRASIL_API' },
      });
      const { refreshed_at, ...profile } = companyProfileResponseFactory.build({
        cnpj,
      });

      await prisma.companyProfile.create({
        data: {
          ...profile,
          refreshed_at: new Date(refreshed_at),
          content_hash: 'varredura-e2e',
          cadastral_source_id: source.id_data_source,
        },
      });
    };
    const publishEvidences = (cnpj: string, date: Date) =>
      prisma.evidenceNormalized.updateMany({
        where: { cnpj },
        data: { published_at: date },
      });
    const movement = (cnpj = CNPJ) =>
      prisma.companyMovement.findUnique({ where: { cnpj } });
    const now = () => new Date();

    beforeAll(async () => {
      ({ app, prisma } = await createDatabaseTestingApp());
      record = app.get(RecordEvidenceCollectionUseCase, { strict: false });
      calculate = app.get(CalculateCompanyOdsScoresUseCase, { strict: false });
      reconcile = app.get(ReconcileCompanyMovementsUseCase, { strict: false });
      repository = app.get(CompanyMovementRepository, { strict: false });
    });
    beforeEach(async () => {
      await prisma.reset(collections);
      await prisma.seed(CATALOG_SEEDERS);
    });
    afterAll(async () => {
      await prisma.reset(collections);
      await app.close();
    });

    it('empresa que ganhou perfil depois do cálculo recebe a movimentação da evidência', async () => {
      const published = new Date('2026-03-10T00:00:00.000Z');

      await infractions(CNPJ, ['AI-001']);
      await calculate.execute(CNPJ);
      await publishEvidences(CNPJ, published);
      await saveProfile(CNPJ);

      await expect(reconcile.execute(now())).resolves.toEqual({ created: 1 });

      expect(await movement()).toMatchObject({
        moved_at: published,
        ods_movements: [
          {
            ods_number: 15,
            direction: 'AVAILABLE',
            cause: 'EVIDENCE_ADDED',
            evidence_category: 'INFRACAO_AMBIENTAL',
            moved_at: published,
          },
        ],
      });
    });

    it('sem publicação, usa a data do fato guardada nos detalhes', async () => {
      await infractions(CNPJ, ['AI-001']);
      await calculate.execute(CNPJ);
      await prisma.evidenceNormalized.updateMany({
        where: { cnpj: CNPJ },
        data: { details: { startDate: '2019-07-10' } },
      });
      await saveProfile(CNPJ);

      await reconcile.execute(now());

      expect((await movement())?.moved_at).toEqual(new Date('2019-07-10'));
    });

    it('sem data do fato, não reconstrói: a coleta não é data da mudança', async () => {
      await infractions(CNPJ, ['AI-001']);
      await calculate.execute(CNPJ);
      await saveProfile(CNPJ);

      await expect(reconcile.execute(now())).resolves.toEqual({ created: 0 });

      expect(await movement()).toBeNull();
    });

    it('repetir não muda nada, e movimentação registrada não é alterada', async () => {
      await infractions(CNPJ, ['AI-001']);
      await calculate.execute(CNPJ);
      await publishEvidences(CNPJ, new Date('2026-03-10T00:00:00.000Z'));
      await saveProfile(CNPJ);
      await reconcile.execute(now());
      const first = await movement();

      await prisma.companyMovement.update({
        where: { cnpj: CNPJ },
        data: { moved_at: new Date('2026-01-01T00:00:00.000Z') },
      });

      await expect(reconcile.execute(now())).resolves.toEqual({ created: 0 });

      expect((await movement())?.moved_at).toEqual(
        new Date('2026-01-01T00:00:00.000Z'),
      );
      expect((await movement())?.ods_movements).toEqual(first?.ods_movements);
    });

    it('sem perfil, ou sem índice, não há movimentação (IND02)', async () => {
      await infractions(CNPJ, ['AI-001']);
      await calculate.execute(CNPJ);
      await saveProfile(OTHER_CNPJ);
      await calculate.execute(OTHER_CNPJ);

      await expect(reconcile.execute(now())).resolves.toEqual({ created: 0 });

      expect(await movement()).toBeNull();
      expect(await movement(OTHER_CNPJ)).toBeNull();
    });

    it('a página segue o cursor até o fim da base', async () => {
      await saveProfile(CNPJ);
      await saveProfile(OTHER_CNPJ);

      const first = await repository.findCandidates(null, 1);
      const second = await repository.findCandidates(first.nextCursor, 1);
      const third = await repository.findCandidates(second.nextCursor, 1);

      expect([first.nextCursor, second.nextCursor]).toEqual([OTHER_CNPJ, CNPJ]);
      expect(third.nextCursor).toBeNull();
    });

    it('createIfMissing não sobrescreve quem chegou antes', async () => {
      await saveProfile(CNPJ);
      await infractions(CNPJ, ['AI-001']);
      await calculate.execute(CNPJ);
      const stored = await movement();

      await expect(
        repository.createIfMissing(CNPJ, [
          {
            odsId: stored!.ods_movements[0].ods_id,
            odsNumber: 15,
            direction: 'INCREASED',
            cause: 'EVIDENCE_ADDED',
            evidenceCategory: 'INFRACAO_AMBIENTAL',
            movedAt: new Date('2020-01-01T00:00:00.000Z'),
          },
        ]),
      ).resolves.toBe(false);

      expect((await movement())?.ods_movements).toEqual(stored?.ods_movements);
    });
  },
);

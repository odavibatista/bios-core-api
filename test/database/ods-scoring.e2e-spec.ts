import type { INestApplication } from '@nestjs/common';
import { EvidenceState } from '@prisma/client';
import { CATALOG_SEEDERS } from '@app/database/catalog.seeders.js';
import { RecordEvidenceCollectionUseCase } from '@modules/evidences/infra/usecases/record-evidence-collection.usecase.js';
import { CalculateCompanyOdsScoresUseCase } from '@modules/scoring/infra/usecases/calculate-company-ods-scores.usecase.js';
import { OdsScoreRepository } from '@modules/scoring/domain/dtos/repositories/ods-score.repository.js';
import { IBAMA_DATASET_URLS } from '@modules/ibama/domain/ibama-evidence.mapper.js';
import { PrismaService } from '@shared/infra/database/prisma.service.js';
import { inject } from 'vitest';
import { createDatabaseTestingApp } from '../support/database-testing-app.js';
import { companyProfileResponseFactory } from '../factories/companies/company-profile.factory.js';

const CNPJ = '11222333000181';
const OTHER_CNPJ = '00000000000191';
const collections = [
  'company_ods_scores',
  'evidence_normalized',
  'evidence_raw',
  'company_profile',
  'data_sources',
  'ods',
];

describe.runIf(inject('databaseAvailable') && inject('redisAvailable'))(
  'RF10: índice por ODS no Mongo real',
  () => {
    let app: INestApplication;
    let prisma: PrismaService;
    let record: RecordEvidenceCollectionUseCase;
    let calculate: CalculateCompanyOdsScoresUseCase;
    let repository: OdsScoreRepository;

    const scores = (cnpj = CNPJ) =>
      prisma.companyOdsScore.findMany({
        where: { cnpj },
        orderBy: { ods_number: 'asc' },
      });
    const collect = (cnpj = CNPJ) =>
      Promise.all([
        record.execute({
          cnpj,
          sourceSlug: 'IBAMA',
          result: {
            status: 'COLLECTED',
            findings: [
              { reference: 'AI-001', url: IBAMA_DATASET_URLS.AUTO_INFRACAO },
            ],
          },
        }),
        record.execute({
          cnpj,
          sourceSlug: 'CGU_CEIS',
          result: {
            status: 'COLLECTED',
            findings: [
              {
                reference: '370679',
                url: 'https://api.portaldatransparencia.gov.br/api-de-dados/ceis/370679',
              },
              {
                reference: '385501',
                url: 'https://api.portaldatransparencia.gov.br/api-de-dados/ceis/385501',
              },
            ],
          },
        }),
        record.execute({
          cnpj,
          sourceSlug: 'CGU_CNEP',
          result: { status: 'COLLECTED', findings: [] },
        }),
        record.execute({
          cnpj,
          sourceSlug: 'GHG_PROTOCOL',
          result: {
            status: 'COLLECTED',
            findings: [
              {
                reference: '5091/19',
                url: 'https://sistema-registropublicodeemissoesapi.fgv.br/GenerateReport/GenerateInventoryReport/5091/19/true',
              },
            ],
          },
        }),
      ]);

    beforeAll(async () => {
      ({ app, prisma } = await createDatabaseTestingApp());
      record = app.get(RecordEvidenceCollectionUseCase, { strict: false });
      calculate = app.get(CalculateCompanyOdsScoresUseCase, { strict: false });
      repository = app.get(OdsScoreRepository, { strict: false });
    });
    beforeEach(async () => {
      await prisma.reset(collections);
      await prisma.seed(CATALOG_SEEDERS);
    });
    afterAll(async () => {
      await prisma.reset(collections);
      await app.close();
    });

    it('sem evidências cria um documento nulo e confiança mínima para cada ODS ativo', async () => {
      const result = await calculate.execute(CNPJ);
      expect(
        result.map((item) => [
          item.odsNumber,
          item.scoreValue,
          item.confidenceValue,
        ]),
      ).toEqual([
        [13, null, 0],
        [15, null, 0],
      ]);
      const persisted = await scores();
      expect(persisted).toHaveLength(2);
      expect(
        persisted.every(
          (item) =>
            item.evidence_count === 0 &&
            item.contributions.length === 0 &&
            item.rules_version === 'rf10-rf11-v3',
        ),
      ).toBe(true);
    });

    it('persiste índices ODS independentes e contribuição auditável por registro', async () => {
      await collect();
      const result = await calculate.execute(CNPJ);
      expect(
        result.map((item) => [
          item.odsNumber,
          item.scoreValue,
          item.evidenceCount,
        ]),
      ).toEqual([
        [13, 60, 1],
        [15, -50, 3],
      ]);
      const evidenceIds = new Set(
        (
          await prisma.evidenceNormalized.findMany({ where: { cnpj: CNPJ } })
        ).map((item) => item.id_evidence),
      );
      const persisted = await scores();
      expect(persisted).toHaveLength(2);
      for (const item of persisted) {
        expect(item.score_value).toBe(
          item.contributions.reduce(
            (sum, contribution) => sum + contribution.points,
            0,
          ),
        );
        expect(item.evidence_count).toBe(item.contributions.length);
        expect(
          item.contributions.every((contribution) =>
            evidenceIds.has(contribution.evidence_id),
          ),
        ).toBe(true);
        expect(item.rules_version).toBe('rf10-rf11-v3');
        expect(item.calculated_at).toBeInstanceOf(Date);
        expect(item.uf).toBeNull();
        expect(item.city).toBeNull();
        expect(item.cnae_codes).toEqual([]);
      }
      expect(
        persisted
          .find((item) => item.ods_number === 15)!
          .contributions.map((item) => [item.category, item.points]),
      ).toEqual([
        ['CONDUTA_ADMINISTRATIVA', -5],
        ['CONDUTA_ADMINISTRATIVA', -5],
        ['INFRACAO_AMBIENTAL', -40],
      ]);
      expect(
        persisted.find((item) => item.ods_number === 13)!.confidence_value,
      ).toBeLessThanOrEqual(0.25);
    });

    it('repetição preserva IDs e criação; nova coleta remove contribuição antiga', async () => {
      await collect();
      await calculate.execute(CNPJ);
      const original = await scores();
      await calculate.execute(CNPJ);
      const repeated = await scores();
      expect(repeated.map((item) => item.id_company_ods_score)).toEqual(
        original.map((item) => item.id_company_ods_score),
      );
      expect(repeated.map((item) => item.created_at)).toEqual(
        original.map((item) => item.created_at),
      );
      expect(repeated.map((item) => item.contributions)).toEqual(
        original.map((item) => item.contributions),
      );

      await record.execute({
        cnpj: CNPJ,
        sourceSlug: 'IBAMA',
        result: { status: 'COLLECTED', findings: [] },
      });
      await calculate.execute(CNPJ);
      expect(
        (await scores()).find((item) => item.ods_number === 15),
      ).toMatchObject({ score_value: -10, evidence_count: 2 });
    });

    it('persiste confiança separada e reduz por UNKNOWN sem alterar o índice', async () => {
      await collect();
      const baseline = (await calculate.execute(CNPJ)).find(
        (item) => item.odsNumber === 15,
      )!;
      expect(baseline.scoreValue).toBe(-50);
      expect(baseline.confidenceValue).toBeCloseTo(0.75 * (2.5 / 3.5));
      expect(
        (await scores()).find((item) => item.ods_number === 15)!
          .confidence_value,
      ).toBeCloseTo(baseline.confidenceValue);

      await prisma.evidenceNormalized.updateMany({
        where: { cnpj: CNPJ, data_source: { slug: 'CGU_CNEP' } },
        data: { state: EvidenceState.UNKNOWN },
      });
      const degraded = (await calculate.execute(CNPJ)).find(
        (item) => item.odsNumber === 15,
      )!;
      expect(degraded.scoreValue).toBe(baseline.scoreValue);
      expect(degraded.evidenceCount).toBe(baseline.evidenceCount);
      expect(degraded.confidenceValue).toBeLessThan(baseline.confidenceValue);
      const persisted = (await scores()).find(
        (item) => item.ods_number === 15,
      )!;
      expect(persisted.score_value).toBe(baseline.scoreValue);
      expect(persisted.confidence_value).toBeCloseTo(degraded.confidenceValue);
    });

    it('descarta confirmação sem proveniência e evidência vencida, sem bônus por NOT_FOUND', async () => {
      await collect();
      await prisma.evidenceNormalized.updateMany({
        where: { cnpj: CNPJ, data_source: { slug: 'GHG_PROTOCOL' } },
        data: { source_reference: null, source_url: null },
      });
      await prisma.evidenceNormalized.updateMany({
        where: { cnpj: CNPJ, data_source: { slug: 'IBAMA' } },
        data: { valid_until: new Date(0) },
      });
      const result = await calculate.execute(CNPJ);
      expect(
        result.map((item) => [
          item.odsNumber,
          item.scoreValue,
          item.evidenceCount,
        ]),
      ).toEqual([
        [13, null, 0],
        [15, -10, 2],
      ]);
      const stored = await prisma.evidenceNormalized.findFirstOrThrow({
        where: { cnpj: CNPJ, data_source: { slug: 'GHG_PROTOCOL' } },
      });
      expect(stored.state).toBe(EvidenceState.CONFIRMED);
      expect(stored.source_reference).toBeNull();
    });

    it('usa UF, cidade e CNAEs do perfil quando existe, sem misturar outro CNPJ', async () => {
      await collect();
      await collect(OTHER_CNPJ);
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
          content_hash: 'scoring-e2e',
          cadastral_source_id: source.id_data_source,
        },
      });
      await calculate.execute(CNPJ);
      const expectedCnaes = [
        ...new Set([
          profile.main_cnae.code,
          ...profile.secondary_cnaes.map((item) => item.code),
        ]),
      ];
      for (const score of await scores())
        expect(score).toMatchObject({
          uf: profile.address.uf,
          city: profile.address.city,
          cnae_codes: expectedCnaes,
        });
      expect(await scores(OTHER_CNPJ)).toHaveLength(0);
    });

    it('ODS desativado deixa de ter score e ODS ativo sem regra falha antes de alterar o retrato', async () => {
      await collect();
      await calculate.execute(CNPJ);
      await prisma.ods.update({
        where: { ods_number: 13 },
        data: { is_active: false },
      });
      await calculate.execute(CNPJ);
      expect((await scores()).map((item) => item.ods_number)).toEqual([15]);
      const previous = await scores();
      await prisma.ods.create({
        data: {
          ods_number: 16,
          title: 'ODS novo',
          description: 'Sem regra ainda',
        },
      });
      await expect(calculate.execute(CNPJ)).rejects.toThrow(
        'ODS 16 sem regras',
      );
      expect(await scores()).toEqual(previous);
    });

    it('erro na segunda escrita desfaz a primeira dentro da transação', async () => {
      const calculated = await calculate.execute(CNPJ);
      await prisma.reset(['company_ods_scores']);
      await expect(
        repository.replaceForCompany(CNPJ, [
          { ...calculated[0], location: null },
          { ...calculated[1], odsId: 'invalido', location: null },
        ]),
      ).rejects.toThrow();
      expect(await scores()).toEqual([]);
    });
  },
);

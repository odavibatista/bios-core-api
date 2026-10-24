import type { INestApplication } from '@nestjs/common';
import { CATALOG_SEEDERS } from '@app/database/catalog.seeders.js';
import {
  CompanyProfileRepository,
  type SearchCompaniesInput,
} from '@modules/companies/domain/dtos/repositories/company-profile.repository.js';
import type { PrismaService } from '@shared/infra/database/prisma.service.js';
import { inject } from 'vitest';
import { createDatabaseTestingApp } from '../support/database-testing-app.js';

const collections = [
  'company_profile',
  'company_ods_scores',
  'data_sources',
  'ods',
];

/** Empresas com perfil: as que alguém já consultou. */
const PROFILES = 6_000;

/** Índices sem perfil: o que a ingestão do IBAMA recalcula para quem ninguém consultou. */
const ORPHANS = 30_000;

/**
 * Desempenho da pesquisa com ODS selecionado (#328), na forma da base de produção: poucas
 * empresas com perfil e muito mais índices do que perfis, porque a ingestão do IBAMA recalcula
 * o índice de empresas que ninguém consultou.
 *
 * Os tetos são folgados de propósito: o objetivo é reprovar a volta ao varrimento do perfil
 * inteiro (que custava segundos nesta mesma base), e não medir milissegundos, que variam com
 * a máquina. O tempo é o de cada consulta, medido no repositório.
 */
describe.runIf(inject('databaseAvailable') && inject('redisAvailable'))(
  'Pesquisa por ODS: desempenho em base com muitos índices órfãos (e2e)',
  () => {
    let app: INestApplication;
    let prisma: PrismaService;
    let repository: CompanyProfileRepository;

    const input = (
      ods: SearchCompaniesInput['ods'],
      criteria: Partial<SearchCompaniesInput> = {},
      skip = 0,
    ): SearchCompaniesInput => ({
      nameTerms: [],
      ...criteria,
      ods,
      skip,
      take: 20,
    });

    /** Tempo de uma pesquisa, em ms, e o resultado. */
    async function timed(search: SearchCompaniesInput) {
      const started = performance.now();
      const result = await repository.search(search);

      return { ms: performance.now() - started, result };
    }

    beforeAll(async () => {
      ({ app, prisma } = await createDatabaseTestingApp());
      repository = app.get(CompanyProfileRepository);
      await prisma.reset(collections);
      await prisma.seed(CATALOG_SEEDERS);

      const source = await prisma.dataSource.findUniqueOrThrow({
        where: { slug: 'BRASIL_API' },
      });
      const ods = await prisma.ods.findUniqueOrThrow({
        where: { ods_number: 15 },
      });
      const ufs = ['SP', 'RJ', 'MG', 'RN', 'BA'];
      const cnaes = ['6201501', '1011201', '4711301', '0111301'];
      const cnpj = (prefix: string, index: number) =>
        `${prefix}${String(index).padStart(13, '0')}`;

      await prisma.companyProfile.createMany({
        data: Array.from({ length: PROFILES }, (_, index) => ({
          cnpj: cnpj('1', index),
          legal_name: `EMPRESA ${index} LTDA`,
          registration_status: 'ATIVA',
          address: { city: 'SAO PAULO', uf: ufs[index % ufs.length] },
          main_cnae: {
            code: cnaes[index % cnaes.length],
            description: 'DESCRICAO',
          },
          secondary_cnaes: [],
          cadastral_source_id: source.id_data_source,
          content_hash: 'hash',
          refreshed_at: new Date(),
        })),
      });

      const row = (
        id: string,
        index: number,
        location: { uf: string | null; city: string | null; cnae: string[] },
      ) => ({
        cnpj: id,
        ods_id: ods.id_ods,
        ods_number: 15,
        score_value: (index % 201) - 100,
        confidence_value: (index % 10) / 10,
        evidence_count: 0,
        contributions: [],
        sources_without_records: [],
        rules_version: 'rf10-rf11-v3',
        uf: location.uf,
        city: location.city,
        cnae_codes: location.cnae,
        calculated_at: new Date(),
      });

      // Metade das empresas com perfil tem índice; os órfãos não têm localização.
      await prisma.companyOdsScore.createMany({
        data: [
          ...Array.from({ length: PROFILES / 2 }, (_, index) =>
            row(cnpj('1', index * 2), index, {
              uf: ufs[(index * 2) % ufs.length],
              city: 'SAO PAULO',
              cnae: [cnaes[(index * 2) % cnaes.length]],
            }),
          ),
          ...Array.from({ length: ORPHANS }, (_, index) =>
            row(cnpj('9', index), index, { uf: null, city: null, cnae: [] }),
          ),
        ],
      });
    }, 120_000);

    afterAll(async () => {
      await prisma.reset(collections);
      await app.close();
    });

    it('índice mínimo com ordenação decrescente sai do índice composto, e não do perfil inteiro', async () => {
      const { ms, result } = await timed(
        input({ number: 15, minScore: 50, order: 'desc' }),
      );

      expect(result.items).toHaveLength(20);
      expect(result.total).toBeGreaterThan(100);
      expect(ms).toBeLessThan(400);
    });

    it('ordenação decrescente sem mínimo: a página dos com nota é rápida', async () => {
      const { ms, result } = await timed(input({ number: 15, order: 'desc' }));

      expect(result.items).toHaveLength(20);
      expect(ms).toBeLessThan(400);
    });

    it('ordenação com UF', async () => {
      const { ms, result } = await timed(
        input({ number: 15, order: 'desc' }, { uf: 'SP' }),
      );

      expect(result.items).toHaveLength(20);
      expect(ms).toBeLessThan(400);
    });

    it('ordenação com CNAE', async () => {
      const { ms, result } = await timed(
        input({ number: 15, order: 'asc' }, { cnaePrefix: '62' }),
      );

      expect(result.items).toHaveLength(20);
      expect(ms).toBeLessThan(400);
    });

    it('só o ODS selecionado, sem mínimo nem ordem: o índice é lido só para a página', async () => {
      const { ms, result } = await timed(input({ number: 15 }));

      expect(result.items).toHaveLength(20);
      expect(result.total).toBe(PROFILES);
      expect(ms).toBeLessThan(400);
    });

    it('só mínimo, na ordem padrão', async () => {
      const { ms, result } = await timed(input({ number: 15, minScore: 0 }));

      expect(result.items).toHaveLength(20);
      expect(ms).toBeLessThan(600);
    });

    it('página distante da lista ordenada', async () => {
      const { ms, result } = await timed(
        input({ number: 15, order: 'desc' }, {}, 1_000),
      );

      expect(result.items).toHaveLength(20);
      expect(ms).toBeLessThan(400);
    });

    it('a última página, que cai no segmento das empresas sem nota, ainda sai em tempo útil', async () => {
      // O segmento das sem nota parte do perfil e é o único que ainda lê o índice por empresa:
      // só é lido quando a página chega nele, e tem teto próprio.
      const { ms, result } = await timed(
        input({ number: 15, order: 'desc' }, {}, PROFILES - 20),
      );

      expect(result.items).toHaveLength(20);
      expect(ms).toBeLessThan(4_000);
    });

    it('os órfãos não entram na contagem nem na lista', async () => {
      const { result } = await timed(
        input({ number: 15, minScore: -100, order: 'asc' }),
      );

      expect(result.total).toBeLessThanOrEqual(PROFILES / 2);
      expect(result.items.some((item) => item.cnpj.startsWith('9'))).toBe(
        false,
      );
    });
  },
);

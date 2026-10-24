import type { INestApplication } from '@nestjs/common';
import { CATALOG_SEEDERS } from '@app/database/catalog.seeders.js';
import { CalculateCompanyOdsScoresUseCase } from '@modules/scoring/infra/usecases/calculate-company-ods-scores.usecase.js';
import {
  CompanyProfileRepository,
  type SearchCompaniesInput,
  type SearchOdsCriteria,
} from '@modules/companies/domain/dtos/repositories/company-profile.repository.js';
import type { PrismaService } from '@shared/infra/database/prisma.service.js';
import { inject } from 'vitest';
import { createDatabaseTestingApp } from '../support/database-testing-app.js';
import { saveOdsScore } from '../support/ods-score.js';

const collections = [
  'company_profile',
  'company_ods_scores',
  'data_sources',
  'ods',
];

/** Uma empresa do conjunto de teste, como o oráculo a conhece. */
interface Company {
  cnpj: string;
  legalName: string;
  tradeName: string | null;
  uf: string;
  city: string;
  cnaes: string[];
}

interface ScoreRow {
  score: number | null;
  confidence: number;
}

/** Empresa e, quando há, o índice dela no ODS pesquisado. */
interface Candidate extends Company {
  score: ScoreRow | null;
}

const NAMES = [
  'AGRO SUL LTDA',
  'BANCO NORTE SA',
  'NORTE BANCO DIGITAL',
  'CASA DO CAMPO',
  'DISTRIBUIDORA AGRO NORTE',
  'ENERGIA VERDE SA',
  'FLORESTA VIVA LTDA',
  'GRAOS DO SUL',
  'HORTIFRUTI CENTRAL',
  'INDUSTRIA QUIMICA SUL',
  'JARDIM BOTANICO',
  'LOGISTICA NORTE SUL',
];
const PLACES: [string, string][] = [
  ['SP', 'SAO PAULO'],
  ['SP', 'CAMPINAS'],
  ['RJ', 'RIO DE JANEIRO'],
  ['MG', 'BELO HORIZONTE'],
];
const CNAES = [
  ['6201501'],
  ['6201501', '4711301'],
  ['1011201'],
  ['0111301', '6201502'],
];
const SCORES_15: (number | null)[] = [
  -45,
  -45,
  -10,
  0,
  0,
  20,
  20,
  60,
  null,
  null,
];
const CONFIDENCES_15 = [0.2, 0.5, 0.5, 0.8, 0, 0.9];
const SCORES_13: (number | null)[] = [60, 60, 0, null, -5];
const CONFIDENCES_13 = [0.3, 0.3, 0.7, 0.1];
const COMPANIES = 36;
const ORPHANS = 12;

/**
 * Equivalência da pesquisa com o oráculo (#328): a pesquisa tem três caminhos (a partir do
 * perfil, dos índices e em dois segmentos), e todos precisam devolver **exatamente** a lista
 * que a regra de negócio define. O oráculo recalcula a regra em memória, em código simples e
 * independente dos pipelines do MongoDB, a partir do que está gravado, e a comparação cobre
 * critérios, ODS, mínimos, ordenação e janelas (inclusive a emenda entre os dois segmentos).
 */
describe.runIf(inject('databaseAvailable') && inject('redisAvailable'))(
  'Pesquisa de empresas: equivalência com o oráculo (e2e)',
  () => {
    let app: INestApplication;
    let prisma: PrismaService;
    let repository: CompanyProfileRepository;
    let companies: Company[];

    const TERMS = (text: string) =>
      text
        .normalize('NFD')
        .replace(/\p{M}/gu, '')
        .toUpperCase()
        .split(/[^A-Z0-9]+/)
        .filter(Boolean);

    /** A regra de negócio da pesquisa, em memória. */
    async function oracle(input: SearchCompaniesInput): Promise<Candidate[]> {
      const scoreRows = input.ods
        ? await prisma.companyOdsScore.findMany({
            where: { ods_number: input.ods.number },
          })
        : [];
      const scoreByCnpj = new Map(
        scoreRows.map((row) => [
          row.cnpj,
          { score: row.score_value ?? null, confidence: row.confidence_value },
        ]),
      );
      const wordStartsMatch = (name: string, terms: string[]) => {
        const words = TERMS(name);

        return terms.every((term) =>
          words.some((word) => word.startsWith(term)),
        );
      };
      const startsPhrase = (company: Company, terms: string[]) =>
        [company.legalName, company.tradeName ?? ''].some((name) => {
          const words = TERMS(name);

          return terms.every((term, index) => words[index]?.startsWith(term));
        });

      let list: Candidate[] = companies
        .filter((company) => {
          if (input.uf !== undefined && company.uf !== input.uf) return false;
          if (
            input.cityTerms !== undefined &&
            TERMS(company.city).join(' ') !== input.cityTerms.join(' ')
          ) {
            return false;
          }
          if (
            input.cnaePrefix !== undefined &&
            !company.cnaes.some((code) =>
              code.startsWith(input.cnaePrefix ?? ''),
            )
          ) {
            return false;
          }
          if (
            input.nameTerms.length > 0 &&
            !input.nameTerms.every((term) =>
              [company.legalName, company.tradeName ?? ''].some((name) =>
                wordStartsMatch(name, [term]),
              ),
            )
          ) {
            return false;
          }

          return true;
        })
        .map((company) => ({
          ...company,
          score: scoreByCnpj.get(company.cnpj) ?? null,
        }));

      const { ods } = input;

      if (ods?.minScore !== undefined) {
        const min = ods.minScore;

        list = list.filter(
          ({ score }) => score?.score != null && score.score >= min,
        );
      }

      if (ods?.minConfidence !== undefined) {
        const min = ods.minConfidence;

        list = list.filter(
          ({ score }) => score !== null && score.confidence >= min,
        );
      }

      const byName = (a: Candidate, b: Candidate) =>
        a.legalName < b.legalName
          ? -1
          : a.legalName > b.legalName
            ? 1
            : a.cnpj < b.cnpj
              ? -1
              : a.cnpj > b.cnpj
                ? 1
                : 0;

      if (ods?.order !== undefined) {
        const direction = ods.order === 'asc' ? 1 : -1;
        const scored = list.filter(({ score }) => score?.score != null);
        const unscored = list.filter(({ score }) => score?.score == null);

        scored.sort(
          (a, b) =>
            direction * ((a.score?.score ?? 0) - (b.score?.score ?? 0)) ||
            (b.score?.confidence ?? 0) - (a.score?.confidence ?? 0) ||
            (a.cnpj < b.cnpj ? -1 : a.cnpj > b.cnpj ? 1 : 0),
        );
        unscored.sort(byName);

        return [...scored, ...unscored];
      }

      if (input.nameTerms.length > 0) {
        const rank = (company: Candidate) =>
          startsPhrase(company, input.nameTerms) ? 0 : 1;

        return list.sort((a, b) => rank(a) - rank(b) || byName(a, b));
      }

      return list.sort(byName);
    }

    const search = (
      criteria: Partial<SearchCompaniesInput>,
      ods: SearchOdsCriteria | undefined,
      skip: number,
      take: number,
    ): SearchCompaniesInput => ({
      nameTerms: [],
      ...criteria,
      ods,
      skip,
      take,
    });

    /** A pesquisa devolve exatamente o que o oráculo manda, na janela pedida. */
    async function expectSameAsOracle(
      input: SearchCompaniesInput,
    ): Promise<void> {
      const expected = await oracle(input);
      const actual = await repository.search(input);
      const window = expected.slice(input.skip, input.skip + input.take);
      const label = JSON.stringify({
        ...input,
        nameTerms: input.nameTerms.join(' '),
      });

      expect(actual.total, `total de ${label}`).toBe(expected.length);
      expect(
        actual.items.map((item) => item.cnpj),
        `cnpjs de ${label}`,
      ).toEqual(window.map((item) => item.cnpj));

      if (input.ods) {
        expect(
          actual.items.map((item) => item.ods_score),
          `ods_score de ${label}`,
        ).toEqual(
          window.map((item) => ({
            ods_number: input.ods?.number,
            score_value: item.score?.score ?? null,
            confidence_value: item.score?.confidence ?? null,
          })),
        );
      } else {
        expect(actual.items.every((item) => item.ods_score === null)).toBe(
          true,
        );
      }
    }

    beforeAll(async () => {
      ({ app, prisma } = await createDatabaseTestingApp());
      repository = app.get(CompanyProfileRepository);
    });

    beforeEach(async () => {
      await prisma.reset(collections);
      await prisma.seed(CATALOG_SEEDERS);
      const source = await prisma.dataSource.findUniqueOrThrow({
        where: { slug: 'BRASIL_API' },
      });

      companies = Array.from({ length: COMPANIES }, (_, index) => {
        const [uf, city] = PLACES[index % PLACES.length];

        return {
          cnpj: String(index + 1).padStart(14, '0'),
          legalName: `${NAMES[index % NAMES.length]} ${String(index).padStart(2, '0')}`,
          tradeName:
            index % 5 === 0
              ? `FANTASIA ${NAMES[(index + 3) % NAMES.length]}`
              : null,
          uf,
          city,
          cnaes: CNAES[index % CNAES.length],
        };
      });

      for (const company of companies) {
        await prisma.companyProfile.create({
          data: {
            cnpj: company.cnpj,
            legal_name: company.legalName,
            ...(company.tradeName ? { trade_name: company.tradeName } : {}),
            registration_status: 'ATIVA',
            address: { city: company.city, uf: company.uf },
            main_cnae: { code: company.cnaes[0], description: 'PRINCIPAL' },
            secondary_cnaes: company.cnaes
              .slice(1)
              .map((code) => ({ code, description: 'SECUNDARIA' })),
            cadastral_source_id: source.id_data_source,
            content_hash: 'hash',
            refreshed_at: new Date(),
          },
        });
      }

      for (const [index, company] of companies.entries()) {
        if (index % 6 !== 5) {
          await saveOdsScore(prisma, company.cnpj, 15, {
            score: SCORES_15[index % SCORES_15.length],
            confidence: CONFIDENCES_15[index % CONFIDENCES_15.length],
          });
        }

        if (index % 3 !== 0) {
          await saveOdsScore(prisma, company.cnpj, 13, {
            score: SCORES_13[index % SCORES_13.length],
            confidence: CONFIDENCES_13[index % CONFIDENCES_13.length],
          });
        }
      }

      // Só a ingestão do IBAMA os conhece: índice sem perfil, notas extremas para vazar à vista.
      for (let index = 0; index < ORPHANS; index += 1) {
        const cnpj = `9${String(index).padStart(13, '0')}`;

        await saveOdsScore(prisma, cnpj, 15, {
          score: index % 2 === 0 ? 99 : -99,
          confidence: 1,
        });
        await saveOdsScore(prisma, cnpj, 13, { score: 99, confidence: 1 });
      }
    });

    afterAll(async () => {
      await prisma.reset(collections);
      await app.close();
    });

    const criteria: [string, Partial<SearchCompaniesInput>][] = [
      ['sem critério cadastral', {}],
      ['uf', { uf: 'SP' }],
      ['uf e município', { uf: 'RJ', cityTerms: ['RIO', 'DE', 'JANEIRO'] }],
      ['município sem uf', { cityTerms: ['CAMPINAS'] }],
      ['CNAE', { cnaePrefix: '62' }],
      ['uf e CNAE', { uf: 'SP', cnaePrefix: '6201' }],
      ['CNAE secundário', { cnaePrefix: '4711' }],
      ['nome', { nameTerms: ['AGRO'] }],
      [
        'nome com várias palavras e uf',
        { nameTerms: ['BANCO', 'NORTE'], uf: 'SP' },
      ],
    ];
    const odsVariants: [string, SearchOdsCriteria | undefined][] = [
      ['sem ODS', undefined],
      ['ODS 15', { number: 15 }],
      ['ODS 15, índice mínimo -20', { number: 15, minScore: -20 }],
      ['ODS 15, índice mínimo 0', { number: 15, minScore: 0 }],
      ['ODS 15, confiança mínima 0,5', { number: 15, minConfidence: 0.5 }],
      [
        'ODS 15, os dois mínimos',
        { number: 15, minScore: 0, minConfidence: 0.5 },
      ],
      ['ODS 13, crescente', { number: 13, order: 'asc' }],
      ['ODS 15, decrescente', { number: 15, order: 'desc' }],
      [
        'ODS 15, índice mínimo 0 e crescente',
        { number: 15, minScore: 0, order: 'asc' },
      ],
      [
        'ODS 15, confiança mínima 0,5 e decrescente',
        { number: 15, minConfidence: 0.5, order: 'desc' },
      ],
      [
        'ODS 13, os dois mínimos e decrescente',
        { number: 13, minScore: -5, minConfidence: 0.3, order: 'desc' },
      ],
      [
        'ODS 15, confiança mínima 0 e crescente',
        { number: 15, minConfidence: 0, order: 'asc' },
      ],
    ];
    const windows: [number, number][] = [
      [0, 7],
      [7, 7],
      [5, 20],
      [30, 10],
    ];

    describe.each(criteria)('critério: %s', (_label, base) => {
      it.each(odsVariants)(
        '%s: as janelas batem com o oráculo',
        async (_o, ods) => {
          for (const [skip, take] of windows) {
            await expectSameAsOracle(search(base, ods, skip, take));
          }
        },
      );
    });

    describe('empresas só com índice (sem perfil)', () => {
      it('nunca entram na lista, por mais alta que seja a nota', async () => {
        for (const order of ['asc', 'desc'] as const) {
          const { items, total } = await repository.search(
            search({}, { number: 15, order }, 0, 100),
          );

          expect(total).toBe(COMPANIES);
          expect(items.some((item) => item.cnpj.startsWith('9'))).toBe(false);
        }
      });

      it('nem com índice mínimo que só elas atingem', async () => {
        const result = await repository.search(
          search({}, { number: 15, minScore: 90 }, 0, 100),
        );

        expect(result).toEqual({ items: [], total: 0 });
      });
    });

    describe('janelas da lista ordenada', () => {
      it('uma página que atravessa a emenda entre quem tem nota e quem não tem', async () => {
        const all = await oracle(
          search({}, { number: 15, order: 'desc' }, 0, 100),
        );
        const scored = all.filter(({ score }) => score?.score != null).length;

        expect(scored).toBeGreaterThan(3);
        expect(scored).toBeLessThan(all.length - 3);
        await expectSameAsOracle(
          search({}, { number: 15, order: 'desc' }, scored - 3, 6),
        );
      });

      it('página exatamente na emenda e página além do fim', async () => {
        const all = await oracle(
          search({}, { number: 15, order: 'asc' }, 0, 100),
        );
        const scored = all.filter(({ score }) => score?.score != null).length;

        await expectSameAsOracle(
          search({}, { number: 15, order: 'asc' }, scored, 5),
        );
        await expectSameAsOracle(
          search({}, { number: 15, order: 'asc' }, all.length + 10, 5),
        );
      });

      it('percorrer todas as páginas devolve cada empresa uma única vez', async () => {
        const seen: string[] = [];

        for (let skip = 0; skip < COMPANIES + 10; skip += 5) {
          const page = await repository.search(
            search({}, { number: 15, order: 'desc' }, skip, 5),
          );

          seen.push(...page.items.map((item) => item.cnpj));
        }

        expect(seen).toHaveLength(COMPANIES);
        expect(new Set(seen).size).toBe(COMPANIES);
      });
    });

    describe('localização gravada no índice', () => {
      it('acompanha o perfil depois de um recálculo: a empresa muda de UF e a pesquisa por UF a acompanha', async () => {
        // O recálculo valida o CNPJ, então esta empresa tem um CNPJ de verdade.
        const cnpj = '11222333000181';
        const source = await prisma.dataSource.findUniqueOrThrow({
          where: { slug: 'BRASIL_API' },
        });

        await prisma.companyProfile.create({
          data: {
            cnpj,
            legal_name: 'ZEBRA MUDANCA LTDA',
            registration_status: 'ATIVA',
            address: { city: 'SAO PAULO', uf: 'SP' },
            main_cnae: { code: '6201501', description: 'PRINCIPAL' },
            secondary_cnaes: [],
            cadastral_source_id: source.id_data_source,
            content_hash: 'hash',
            refreshed_at: new Date(),
          },
        });
        companies = [
          ...companies,
          {
            cnpj,
            legalName: 'ZEBRA MUDANCA LTDA',
            tradeName: null,
            uf: 'SP',
            city: 'SAO PAULO',
            cnaes: ['6201501'],
          },
        ];
        await app.get(CalculateCompanyOdsScoresUseCase).execute(cnpj);
        await expectSameAsOracle(
          search({ uf: 'SP' }, { number: 15, order: 'desc' }, 0, 60),
        );

        await prisma.companyProfile.update({
          where: { cnpj },
          data: { address: { city: 'CURITIBA', uf: 'PR' } },
        });
        await app.get(CalculateCompanyOdsScoresUseCase).execute(cnpj);
        companies = companies.map((company) =>
          company.cnpj === cnpj
            ? { ...company, uf: 'PR', city: 'CURITIBA' }
            : company,
        );

        await expectSameAsOracle(
          search({ uf: 'PR' }, { number: 15, order: 'desc' }, 0, 20),
        );
        await expectSameAsOracle(
          search({ uf: 'SP' }, { number: 15, order: 'desc' }, 0, 60),
        );
        const inParana = await repository.search(
          search({ uf: 'PR' }, { number: 15, order: 'desc' }, 0, 20),
        );

        expect(inParana.items.map((item) => item.cnpj)).toEqual([cnpj]);
      });
    });
  },
);

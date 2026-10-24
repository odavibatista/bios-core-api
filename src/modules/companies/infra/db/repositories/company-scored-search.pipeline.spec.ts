import type { SearchCompaniesInput } from '../../../domain/dtos/repositories/company-profile.repository.js';
import {
  buildScoredCnpjsPipeline,
  buildScoredCountPipeline,
  buildScoredFilteredPipeline,
  buildScoredPagePipeline,
  canSearchFromScores,
  scoredMatch,
  type ScoredSearchInput,
} from './company-scored-search.pipeline.js';

type Stage = Record<string, unknown>;

function searchOf(
  input: Partial<SearchCompaniesInput> = {},
  ods: Partial<NonNullable<SearchCompaniesInput['ods']>> = {},
): ScoredSearchInput {
  return {
    nameTerms: [],
    skip: 0,
    take: 20,
    ...input,
    ods: { number: 15, ...ods },
  };
}

const asStages = (pipeline: unknown) => pipeline as Stage[];

describe('pesquisa a partir dos índices', () => {
  describe('quando sai dos índices', () => {
    const base: SearchCompaniesInput = { nameTerms: [], skip: 0, take: 20 };

    it.each([
      ['índice mínimo', { number: 15, minScore: 0 }],
      ['confiança mínima', { number: 15, minConfidence: 0.5 }],
      ['ordenação', { number: 15, order: 'desc' as const }],
    ])('com %s e sem nome', (_label, ods) => {
      expect(canSearchFromScores({ ...base, ods })).toBe(true);
    });

    it('o mínimo zero também conta (não é tratado como ausente)', () => {
      expect(
        canSearchFromScores({
          ...base,
          ods: { number: 15, minScore: 0, minConfidence: 0 },
        }),
      ).toBe(true);
    });

    it('só o ODS, sem mínimo nem ordem: o índice só aparece na página, parte do perfil', () => {
      expect(canSearchFromScores({ ...base, ods: { number: 15 } })).toBe(false);
    });

    it('sem ODS, parte do perfil', () => {
      expect(canSearchFromScores({ ...base, uf: 'SP' })).toBe(false);
    });

    it('com nome, parte do perfil: o nome não está nos índices', () => {
      expect(
        canSearchFromScores({
          ...base,
          nameTerms: ['AMBEV'],
          ods: { number: 15, order: 'asc' },
        }),
      ).toBe(false);
    });
  });

  describe('o $match dos índices', () => {
    it('sempre limita ao ODS e às empresas com perfil (uf não nulo)', () => {
      expect(scoredMatch(searchOf(), 'any')).toEqual({
        ods_number: 15,
        uf: { $ne: null },
      });
    });

    it('a UF pedida substitui o corte de "tem perfil", porque já o implica', () => {
      expect(scoredMatch(searchOf({ uf: 'SP' }), 'any')).toMatchObject({
        uf: 'SP',
      });
    });

    it('município: o nome inteiro, ignorando acento, caixa e pontuação', () => {
      const match = scoredMatch(
        searchOf({ cityTerms: ['SAO', 'PAULO'] }),
        'any',
      ) as { city: { $regex: string; $options: string } };
      const regex = new RegExp(match.city.$regex, `${match.city.$options}u`);

      expect(regex.test('SÃO PAULO')).toBe(true);
      expect(regex.test('São Paulo')).toBe(true);
      expect(regex.test('SAO PAULO DO POTENGI')).toBe(false);
    });

    it('CNAE: prefixo de qualquer código do array (principal ou secundário)', () => {
      const match = scoredMatch(searchOf({ cnaePrefix: '62' }), 'any') as {
        cnae_codes: { $regex: string };
      };
      const regex = new RegExp(match.cnae_codes.$regex);

      expect(regex.test('6201501')).toBe(true);
      expect(regex.test('4711301')).toBe(false);
      expect(regex.test('0162000')).toBe(false);
    });

    it('sem critério de município ou CNAE, não os inclui', () => {
      const match = scoredMatch(searchOf(), 'any');

      expect(match).not.toHaveProperty('city');
      expect(match).not.toHaveProperty('cnae_codes');
    });

    describe('o índice mínimo e a nota', () => {
      it('modo "com nota" sem mínimo: nota não nula', () => {
        expect(scoredMatch(searchOf(), 'scored')).toMatchObject({
          score_value: { $ne: null },
        });
      });

      it('modo "com nota" com mínimo: nota >= mínimo (o mínimo já exclui o nulo)', () => {
        expect(
          scoredMatch(searchOf({}, { minScore: -20 }), 'scored'),
        ).toMatchObject({ score_value: { $gte: -20 } });
      });

      it('o mínimo zero filtra (não é tratado como ausente)', () => {
        expect(
          scoredMatch(searchOf({}, { minScore: 0 }), 'scored'),
        ).toMatchObject({ score_value: { $gte: 0 } });
      });

      it('modo "sem nota": nota nula (ausente ou nula)', () => {
        expect(scoredMatch(searchOf(), 'unscored')).toMatchObject({
          score_value: null,
        });
      });

      it('modo "qualquer" sem mínimo: não restringe a nota', () => {
        expect(scoredMatch(searchOf(), 'any')).not.toHaveProperty(
          'score_value',
        );
      });

      it('modo "qualquer" com mínimo: nota >= mínimo', () => {
        expect(
          scoredMatch(searchOf({}, { minScore: 10 }), 'any'),
        ).toMatchObject({ score_value: { $gte: 10 } });
      });
    });

    it('a confiança mínima filtra em todos os modos, inclusive o zero', () => {
      for (const mode of ['any', 'scored', 'unscored'] as const) {
        expect(
          scoredMatch(searchOf({}, { minConfidence: 0 }), mode),
        ).toMatchObject({ confidence_value: { $gte: 0 } });
      }
    });
  });

  describe('pesquisa com mínimos e sem ordenação pelo ODS', () => {
    const pipeline = asStages(
      buildScoredFilteredPipeline(searchOf({}, { minScore: 0 })),
    );

    it('filtra os índices, junta o perfil e só então ordena e pagina', () => {
      const keys = pipeline.map((stage) => Object.keys(stage)[0]);

      expect(keys).toEqual(['$match', '$lookup', '$unwind', '$facet']);
      expect(pipeline[1]).toMatchObject({
        $lookup: {
          from: 'company_profile',
          localField: 'cnpj',
          foreignField: 'cnpj',
          as: 'profile',
        },
      });
    });

    it('a ordem é a padrão da lista: razão social e CNPJ', () => {
      const { $facet } = pipeline[3] as {
        $facet: { items: Stage[]; total: Stage[] };
      };

      expect($facet.items[0]).toEqual({
        $sort: { 'profile.legal_name': 1, cnpj: 1 },
      });
      expect($facet.items.slice(1, 3)).toEqual([{ $skip: 0 }, { $limit: 20 }]);
      expect($facet.total).toEqual([{ $count: 'count' }]);
    });

    it('aplica a janela pedida', () => {
      const [, , , { $facet }] = asStages(
        buildScoredFilteredPipeline(
          searchOf({ skip: 40, take: 10 }, { minScore: 0 }),
        ),
      ) as unknown as [Stage, Stage, Stage, { $facet: { items: Stage[] } }];

      expect($facet.items.slice(1, 3)).toEqual([{ $skip: 40 }, { $limit: 10 }]);
    });
  });

  describe('página da lista ordenada pelo índice', () => {
    it.each([
      ['asc', 1],
      ['desc', -1],
    ] as const)(
      '%s: a nota no sentido pedido, maior confiança primeiro, CNPJ por último',
      (order, direction) => {
        const [, sort] = asStages(
          buildScoredPagePipeline(searchOf({}, { order }), 0, 20),
        );

        expect(sort).toEqual({
          $sort: { score_value: direction, confidence_value: -1, cnpj: 1 },
        });
        expect(Object.keys((sort as { $sort: object }).$sort)).toEqual([
          'score_value',
          'confidence_value',
          'cnpj',
        ]);
      },
    );

    it('pagina antes de juntar o perfil: só a página custa uma junção', () => {
      const keys = asStages(
        buildScoredPagePipeline(searchOf({}, { order: 'desc' }), 40, 10),
      ).map((stage) => Object.keys(stage)[0]);

      expect(keys).toEqual([
        '$match',
        '$sort',
        '$skip',
        '$limit',
        '$lookup',
        '$unwind',
        '$project',
      ]);
    });

    it('aplica o salto e o tamanho dados (a janela do segmento, e não da lista)', () => {
      const stages = asStages(
        buildScoredPagePipeline(
          searchOf({ skip: 99, take: 99 }, { order: 'asc' }),
          3,
          7,
        ),
      );

      expect(stages[2]).toEqual({ $skip: 3 });
      expect(stages[3]).toEqual({ $limit: 7 });
    });

    it('só lista quem tem nota', () => {
      const [match] = asStages(
        buildScoredPagePipeline(searchOf({}, { order: 'asc' }), 0, 20),
      ) as unknown as [{ $match: Record<string, unknown> }];

      expect(match.$match).toMatchObject({ score_value: { $ne: null } });
    });

    it('o item sai com o ODS, a nota e a confiança do índice, e o resumo do perfil', () => {
      const project = asStages(
        buildScoredPagePipeline(searchOf({}, { order: 'asc' }), 0, 20),
      ).at(-1) as { $project: Record<string, unknown> };

      expect(Object.keys(project.$project).sort()).toEqual(
        [
          '_id',
          'city',
          'cnpj',
          'legal_name',
          'main_cnae',
          'ods_score',
          'registration_status',
          'trade_name',
          'uf',
        ].sort(),
      );
      expect(project.$project.ods_score).toEqual({
        ods_number: { $literal: 15 },
        score_value: { $ifNull: ['$score_value', null] },
        confidence_value: { $ifNull: ['$confidence_value', null] },
      });
      expect(project.$project.legal_name).toBe('$profile.legal_name');
    });
  });

  describe('contagem e lista de CNPJs', () => {
    it('a contagem usa o mesmo $match, no modo pedido', () => {
      const input = searchOf({ uf: 'SP' }, { minScore: 5 });

      expect(buildScoredCountPipeline(input, 'scored')).toEqual([
        { $match: scoredMatch(input, 'scored') },
        { $count: 'count' },
      ]);
    });

    it('a lista de CNPJs traz só o CNPJ', () => {
      const input = searchOf({}, { minConfidence: 0.5 });

      expect(buildScoredCnpjsPipeline(input, 'unscored')).toEqual([
        { $match: scoredMatch(input, 'unscored') },
        { $project: { _id: 0, cnpj: 1 } },
      ]);
    });
  });
});

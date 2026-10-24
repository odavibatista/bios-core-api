import { extractNameTerms } from '../../../domain/company-name-terms.js';
import type { SearchCompaniesInput } from '../../../domain/dtos/repositories/company-profile.repository.js';
import { buildCompanySearchPipeline } from './company-search.pipeline.js';

interface RegexCondition {
  $regex: string;
  $options?: string;
}

type Stage = Record<string, unknown>;
type Condition = Record<string, unknown>;

function pipelineOf(input: Partial<SearchCompaniesInput> = {}): Stage[] {
  return buildCompanySearchPipeline({
    nameTerms: [],
    skip: 0,
    take: 20,
    ...input,
  }) as unknown as Stage[];
}

/** Condições do `$match` cadastral (o primeiro estágio, quando há filtro). */
function conditionsOf(input: Partial<SearchCompaniesInput>): Condition[] {
  const [first] = pipelineOf(input);

  return (first as { $match: { $and: Condition[] } }).$match.$and;
}

function stageOf(pipeline: Stage[], key: string): Stage | undefined {
  return pipeline.find((stage) => key in stage);
}

function facetOf(input: Partial<SearchCompaniesInput>) {
  const stage = stageOf(pipelineOf(input), '$facet') as {
    $facet: { items: Stage[]; total: Stage[] };
  };

  return stage.$facet;
}

/**
 * As expressões regulares do pipeline rodam no MongoDB (PCRE); aqui são
 * executadas pelo motor do JavaScript, que entende a mesma sintaxe usada
 * (`(?<!...)` e `\p{..}`), para provar o que casam sem precisar do banco. O
 * comportamento no MongoDB real é coberto pelo e2e.
 */
function matches(query: string, name: string, field = 'legal_name'): boolean {
  return conditionsOf({ nameTerms: extractNameTerms(query) }).every(
    (condition) => {
      const { $or } = condition as { $or: Record<string, RegexCondition>[] };
      const candidate = $or.find((entry) => field in entry);
      const { $regex, $options } = candidate?.[field] as RegexCondition;

      return new RegExp($regex, `${$options}u`).test(name);
    },
  );
}

function phraseRegex(query: string): RegExp {
  const { $addFields } = stageOf(
    pipelineOf({ nameTerms: extractNameTerms(query) }),
    '$addFields',
  ) as {
    $addFields: {
      search_rank: {
        $cond: [{ $or: { $regexMatch: { regex: string } }[] }, number, number];
      };
    };
  };

  return new RegExp(
    $addFields.search_rank.$cond[0].$or[0].$regexMatch.regex,
    'iu',
  );
}

function cityRegex(city: string): RegExp {
  const [condition] = conditionsOf({ cityTerms: extractNameTerms(city) });
  const { $regex, $options } = (
    condition as { 'address.city': RegexCondition }
  )['address.city'];

  return new RegExp($regex, `${$options}u`);
}

describe('buildCompanySearchPipeline', () => {
  describe('nome: quem entra', () => {
    it('a palavra inteira casa', () => {
      expect(matches('petrobras', 'PETROLEO BRASILEIRO S A PETROBRAS')).toBe(
        true,
      );
    });

    it('a palavra pela metade casa o começo de uma palavra', () => {
      expect(matches('petro', 'PETROLEO BRASILEIRO S A')).toBe(true);
      expect(matches('brasil', 'PETROLEO BRASILEIRO S A')).toBe(true);
    });

    it('o meio ou o fim de uma palavra não casa', () => {
      expect(matches('leo', 'PETROLEO BRASILEIRO S A')).toBe(false);
      expect(matches('eiro', 'PETROLEO BRASILEIRO S A')).toBe(false);
    });

    it('a caixa não importa', () => {
      expect(matches('PeTrO', 'petroleo brasileiro')).toBe(true);
    });

    it('todas as palavras precisam casar, em qualquer ordem', () => {
      expect(matches('limpeza urbana', 'URBANA LIMPEZA LTDA')).toBe(true);
      expect(matches('limpeza urbana', 'LIMPEZA PREDIAL LTDA')).toBe(false);
    });

    it('o acento do cadastro não atrapalha a palavra digitada sem acento', () => {
      expect(matches('industria', 'INDÚSTRIA E COMÉRCIO')).toBe(true);
      expect(matches('acao', 'AÇÃO SOCIAL')).toBe(true);
      expect(matches('sao', 'SÃO JOÃO')).toBe(true);
    });

    it('a palavra digitada com acento também casa (o texto chega sem acento ao pipeline)', () => {
      expect(matches('Indústria', 'INDUSTRIA E COMERCIO')).toBe(true);
    });

    it('o acento é tolerado em minúsculas também', () => {
      expect(matches('industria', 'indústria e comércio')).toBe(true);
    });

    it('uma letra acentuada antes da palavra a separa da anterior, e não a emenda', () => {
      expect(matches('gua', 'ÁGUA E LUZ')).toBe(false);
    });

    it('pontuação e dígitos separam as palavras', () => {
      expect(matches('cia', 'AMBEV S.A./CIA. DE BEBIDAS')).toBe(true);
      expect(matches('24', 'LOJA 24 HORAS')).toBe(true);
    });

    it('procura também no nome fantasia', () => {
      expect(matches('fantasia', 'RAZAO LTDA', 'legal_name')).toBe(false);
      expect(matches('fantasia', 'NOME FANTASIA', 'trade_name')).toBe(true);
    });

    it('o CPF mascarado no nome não pode ser encontrado por dígitos', () => {
      expect(matches('12345678901', 'JOAO DA SILVA ***')).toBe(false);
    });
  });

  describe('metacaracteres', () => {
    it('o ponto digitado não é curinga: separa palavras, e não casa qualquer letra', () => {
      // Se `x.z` virasse a expressão `X.Z`, casaria `XYZ`.
      expect(matches('x.z', 'XYZ LTDA')).toBe(false);
      expect(matches('x.z', 'X Z LTDA')).toBe(true);
    });

    it('parênteses, colchetes e barras digitados não alteram a expressão', () => {
      expect(() => matches('a(b[c|d\\e', 'A B C D E')).not.toThrow();
      expect(matches('(abc|xyz)', 'XYZ LTDA')).toBe(false);
    });

    it('o município digitado também não vira metacaractere', () => {
      expect(() => cityRegex('a(b[c|d\\e')).not.toThrow();
      expect(cityRegex('s.o paulo').test('SAO PAULO')).toBe(false);
    });
  });

  describe('UF', () => {
    it('compara a sigla exata do endereço', () => {
      expect(conditionsOf({ uf: 'SP' })).toEqual([{ 'address.uf': 'SP' }]);
    });
  });

  describe('município', () => {
    it('casa o nome inteiro, ignorando acento, caixa e pontuação', () => {
      const regex = cityRegex("Santa Bárbara d'Oeste");

      expect(regex.test('SANTA BARBARA D OESTE')).toBe(true);
      expect(regex.test("Santa Bárbara d'Oeste")).toBe(true);
      expect(regex.test('SANTA BÁRBARA D’OESTE')).toBe(true);
    });

    it('não é busca por início de palavra: o nome precisa ser o mesmo', () => {
      expect(cityRegex('sao paulo').test('SAO PAULO DO POTENGI')).toBe(false);
      expect(cityRegex('paulo').test('SAO PAULO')).toBe(false);
      expect(cityRegex('sao paulo').test('SAO PAULO')).toBe(true);
    });

    it('tolera acento no cadastro e na digitação', () => {
      expect(cityRegex('sao paulo').test('SÃO PAULO')).toBe(true);
      expect(cityRegex('São Paulo').test('SAO PAULO')).toBe(true);
    });

    it('município sem palavras não vira filtro', () => {
      expect(conditionsOf({ cityTerms: [], uf: 'SP' })).toEqual([
        { 'address.uf': 'SP' },
      ]);
    });
  });

  describe('CNAE', () => {
    function cnaeRegex(prefix: string): RegExp {
      const [condition] = conditionsOf({ cnaePrefix: prefix });
      const { $or } = condition as { $or: Record<string, RegexCondition>[] };

      return new RegExp($or[0]['main_cnae.code'].$regex);
    }

    it('casa o CNAE principal e algum secundário', () => {
      const [condition] = conditionsOf({ cnaePrefix: '6201' });

      expect(condition).toEqual({
        $or: [
          { 'main_cnae.code': { $regex: '^6201' } },
          { 'secondary_cnaes.code': { $regex: '^6201' } },
        ],
      });
    });

    it('divisão, grupo, classe e subclasse são prefixos do código', () => {
      expect(cnaeRegex('62').test('6201501')).toBe(true);
      expect(cnaeRegex('620').test('6201501')).toBe(true);
      expect(cnaeRegex('62015').test('6201501')).toBe(true);
      expect(cnaeRegex('6201501').test('6201501')).toBe(true);
    });

    it('só o começo do código conta', () => {
      expect(cnaeRegex('01').test('6201501')).toBe(false);
      expect(cnaeRegex('6201502').test('6201501')).toBe(false);
    });
  });

  describe('critérios somados', () => {
    it('cada critério vira uma condição, todas exigidas ao mesmo tempo', () => {
      const conditions = conditionsOf({
        nameTerms: ['ACME'],
        uf: 'SP',
        cityTerms: ['SAO', 'PAULO'],
        cnaePrefix: '62',
      });

      expect(conditions).toHaveLength(4);
    });

    it('sem critério cadastral, não há $match (a pesquisa só por ODS lista a base)', () => {
      const pipeline = pipelineOf({ ods: { number: 15 } });

      expect(stageOf(pipeline, '$match')).toBeUndefined();
    });
  });

  describe('ODS selecionado', () => {
    it('sem ODS, não consulta o índice e o item traz ods_score nulo', () => {
      const pipeline = pipelineOf({ uf: 'SP' });
      const { $project } = facetOf({ uf: 'SP' }).items[3] as {
        $project: { ods_score: unknown };
      };

      expect(stageOf(pipeline, '$lookup')).toBeUndefined();
      expect($project.ods_score).toEqual({ $literal: null });
    });

    it('junta o índice e a confiança do ODS pelo CNPJ e pelo número do ODS', () => {
      const pipeline = pipelineOf({ uf: 'SP', ods: { number: 15 } });
      const { $lookup } = stageOf(pipeline, '$lookup') as {
        $lookup: {
          from: string;
          let: Record<string, string>;
          pipeline: Stage[];
          as: string;
        };
      };

      expect($lookup.from).toBe('company_ods_scores');
      expect($lookup.as).toBe('ods_score');
      expect($lookup.let).toEqual({ company_cnpj: '$cnpj' });
      expect($lookup.pipeline[0]).toEqual({
        $match: {
          $expr: {
            $and: [
              { $eq: ['$cnpj', '$$company_cnpj'] },
              { $eq: ['$ods_number', 15] },
            ],
          },
        },
      });
      expect($lookup.pipeline[1]).toEqual({
        $project: { _id: 0, score_value: 1, confidence_value: 1 },
      });
    });

    it('sem mínimos, não filtra por índice nem por confiança', () => {
      const matches = pipelineOf({ ods: { number: 15 } }).filter(
        (stage) => '$match' in stage,
      );

      expect(matches).toEqual([]);
    });

    it('o índice mínimo filtra por score_value >= mínimo', () => {
      const pipeline = pipelineOf({ ods: { number: 15, minScore: -20 } });

      expect(pipeline).toContainEqual({
        $match: { 'ods_score.score_value': { $gte: -20 } },
      });
    });

    it('o mínimo zero também filtra (não é tratado como ausente)', () => {
      const pipeline = pipelineOf({
        ods: { number: 15, minScore: 0, minConfidence: 0 },
      });

      expect(pipeline).toContainEqual({
        $match: { 'ods_score.score_value': { $gte: 0 } },
      });
      expect(pipeline).toContainEqual({
        $match: { 'ods_score.confidence_value': { $gte: 0 } },
      });
    });

    it('a confiança mínima filtra por confidence_value >= mínimo', () => {
      const pipeline = pipelineOf({ ods: { number: 13, minConfidence: 0.6 } });

      expect(pipeline).toContainEqual({
        $match: { 'ods_score.confidence_value': { $gte: 0.6 } },
      });
    });

    it('o item traz o ODS selecionado, o índice e a confiança (nulos sem cálculo)', () => {
      const { $project } = facetOf({ ods: { number: 15 } }).items[3] as {
        $project: { ods_score: Record<string, unknown> };
      };

      expect($project.ods_score).toEqual({
        ods_number: { $literal: 15 },
        score_value: { $ifNull: ['$ods_score.score_value', null] },
        confidence_value: { $ifNull: ['$ods_score.confidence_value', null] },
      });
    });
  });

  describe('ordem', () => {
    it('quem começa pela frase digitada tem prioridade', () => {
      const regex = phraseRegex('banco brasil');

      expect(regex.test('BANCO DO BRASIL S A')).toBe(false);
      expect(regex.test('BANCO BRASILEIRO DE DESCONTOS')).toBe(true);
      expect(regex.test('NOVO BANCO BRASIL')).toBe(false);
    });

    it('a frase de uma palavra só olha o começo do nome', () => {
      const regex = phraseRegex('ambev');

      expect(regex.test('AMBEV S.A.')).toBe(true);
      expect(regex.test('DISTRIBUIDORA AMBEV')).toBe(false);
    });

    it('com nome, ordena pela prioridade, pela razão social e pelo CNPJ', () => {
      expect(facetOf({ nameTerms: ['AMBEV'] }).items[0]).toEqual({
        $sort: { search_rank: 1, legal_name: 1, cnpj: 1 },
      });
    });

    it('sem nome, não há prioridade: razão social e CNPJ', () => {
      const pipeline = pipelineOf({ uf: 'SP' });

      expect(stageOf(pipeline, '$addFields')).toBeUndefined();
      expect(facetOf({ uf: 'SP' }).items[0]).toEqual({
        $sort: { legal_name: 1, cnpj: 1 },
      });
    });
  });

  describe('janela e total', () => {
    it('aplica o salto e o tamanho da página, depois da ordenação', () => {
      const { items, total } = facetOf({
        nameTerms: ['AMBEV'],
        skip: 40,
        take: 20,
      });

      expect(items.slice(0, 3)).toEqual([
        expect.objectContaining({ $sort: expect.any(Object) }),
        { $skip: 40 },
        { $limit: 20 },
      ]);
      expect(total).toEqual([{ $count: 'count' }]);
    });

    it('projeta só o resumo da empresa, sem o _id nem os hashes', () => {
      const { $project } = facetOf({ nameTerms: ['AMBEV'] }).items[3] as {
        $project: Record<string, unknown>;
      };

      expect(Object.keys($project).sort()).toEqual(
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
    });
  });
});

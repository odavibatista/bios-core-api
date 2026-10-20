import { extractNameTerms } from '../../../domain/company-name-terms.js';
import { buildNameSearchPipeline } from './company-name-search.pipeline.js';

interface NameCondition {
  $regex: string;
  $options: string;
}

type Stage = Record<string, unknown>;

/**
 * As expressões regulares do pipeline rodam no MongoDB (PCRE); aqui são
 * executadas pelo motor do JavaScript, que entende a mesma sintaxe usada
 * (`(?<!...)` e `\p{..}`), para provar o que casam sem precisar do banco. O
 * comportamento no MongoDB real é coberto pelo e2e.
 */
function matchStage(text: string) {
  const pipeline = buildNameSearchPipeline(extractNameTerms(text), 0, 20);
  const { $match } = pipeline[0] as unknown as {
    $match: { $and: { $or: Record<string, NameCondition>[] }[] };
  };

  return $match.$and;
}

function matches(query: string, name: string, field = 'legal_name'): boolean {
  return matchStage(query).every(({ $or }) => {
    const condition = $or.find((candidate) => field in candidate);
    const { $regex, $options } = condition?.[field] as NameCondition;

    return new RegExp($regex, `${$options}u`).test(name);
  });
}

function phraseRegex(query: string): RegExp {
  const pipeline = buildNameSearchPipeline(extractNameTerms(query), 0, 20);
  const { $addFields } = pipeline[1] as {
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

describe('buildNameSearchPipeline', () => {
  describe('quem entra', () => {
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

    it('ordena pela prioridade, pela razão social e pelo CNPJ', () => {
      const pipeline = buildNameSearchPipeline(['AMBEV'], 0, 20);
      const { $facet } = pipeline[2] as { $facet: { items: Stage[] } };

      expect($facet.items[0]).toEqual({
        $sort: { search_rank: 1, legal_name: 1, cnpj: 1 },
      });
    });
  });

  describe('janela e total', () => {
    it('aplica o salto e o tamanho da página, depois da ordenação', () => {
      const [, , { $facet }] = buildNameSearchPipeline(['AMBEV'], 40, 20) as [
        Stage,
        Stage,
        { $facet: { items: Stage[]; total: Stage[] } },
      ];

      expect($facet.items.slice(0, 3)).toEqual([
        expect.objectContaining({ $sort: expect.any(Object) }),
        { $skip: 40 },
        { $limit: 20 },
      ]);
      expect($facet.total).toEqual([{ $count: 'count' }]);
    });

    it('projeta só o resumo da empresa, sem o _id nem os hashes', () => {
      const [, , { $facet }] = buildNameSearchPipeline(['AMBEV'], 0, 20) as [
        Stage,
        Stage,
        { $facet: { items: Stage[] } },
      ];
      const { $project } = $facet.items[3] as {
        $project: Record<string, unknown>;
      };

      expect(Object.keys($project).sort()).toEqual(
        [
          '_id',
          'city',
          'cnpj',
          'legal_name',
          'main_cnae',
          'registration_status',
          'trade_name',
          'uf',
        ].sort(),
      );
    });
  });
});

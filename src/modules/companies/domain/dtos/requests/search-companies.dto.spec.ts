import {
  BRAZILIAN_UFS,
  ExportCompaniesQuerySchema,
  CompanySearchItemSchema,
  SearchCompaniesQuerySchema,
  SearchCompaniesResponseSchema,
} from './search-companies.dto.js';

const parse = (query: Record<string, unknown>) =>
  SearchCompaniesQuerySchema.safeParse(query);

describe('SearchCompaniesQuerySchema', () => {
  describe('nome', () => {
    it('aceita o nome e completa a paginação com os padrões', () => {
      expect(SearchCompaniesQuerySchema.parse({ name: 'petrobras' })).toEqual({
        name: 'petrobras',
        page: 1,
        page_size: 20,
      });
    });

    it('converte a paginação que vem como texto na query string', () => {
      expect(
        SearchCompaniesQuerySchema.parse({
          name: 'natura',
          page: '3',
          page_size: '50',
        }),
      ).toMatchObject({ page: 3, page_size: 50 });
    });

    it('apara os espaços das pontas', () => {
      expect(SearchCompaniesQuerySchema.parse({ name: '  ambev  ' }).name).toBe(
        'ambev',
      );
    });

    it('recusa quando nenhuma palavra tem 3 caracteres ou mais', () => {
      const result = parse({ name: 'a b do' });

      expect(result.success).toBe(false);
      expect(result.error?.issues[0].message).toMatch(/3 letras ou mais/);
      expect(result.error?.issues[0].path).toEqual(['name']);
    });

    it('recusa o nome curto mesmo com outros critérios', () => {
      expect(parse({ name: 'a b do', uf: 'SP' }).success).toBe(false);
    });

    it('aceita palavras curtas junto de uma significativa', () => {
      expect(parse({ name: 'banco do brasil s a' }).success).toBe(true);
    });

    it('recusa o texto que passa de 100 caracteres', () => {
      expect(parse({ name: 'a'.repeat(101) }).success).toBe(false);
      expect(parse({ name: 'a'.repeat(100) }).success).toBe(true);
    });

    it('recusa paginação fora dos limites', () => {
      const name = 'petrobras';

      expect(parse({ name, page: '0' }).success).toBe(false);
      expect(parse({ name, page_size: '101' }).success).toBe(false);
    });
  });

  describe('ao menos um critério', () => {
    it.each([
      ['nada', {}],
      ['nome vazio', { name: '' }],
      ['nome só de espaços', { name: '   ' }],
      ['só paginação', { page: '2', page_size: '10' }],
      ['campos em branco', { uf: '', city: ' ', cnae: '', ods: '' }],
    ])('recusa %s', (_caso, query) => {
      const result = parse(query);

      expect(result.success).toBe(false);
      expect(result.error?.issues[0].message).toMatch(/ao menos um critério/);
    });

    it.each([
      ['nome', { name: 'ambev' }],
      ['UF', { uf: 'SP' }],
      ['município', { city: 'Santos' }],
      ['CNAE', { cnae: '62' }],
      ['ODS', { ods: '15' }],
    ])('aceita só o critério %s', (_caso, query) => {
      expect(parse(query).success).toBe(true);
    });
  });

  describe('UF', () => {
    it('aceita a sigla em qualquer caixa e a devolve em maiúsculas', () => {
      expect(SearchCompaniesQuerySchema.parse({ uf: ' sp ' }).uf).toBe('SP');
    });

    it('aceita as 27 unidades da federação', () => {
      expect(BRAZILIAN_UFS).toHaveLength(27);
      for (const uf of BRAZILIAN_UFS) expect(parse({ uf }).success).toBe(true);
    });

    it.each(['XX', 'S', 'SPP', '12', 'São Paulo'])('recusa %s', (uf) => {
      expect(parse({ uf }).success).toBe(false);
    });
  });

  describe('município', () => {
    it('aceita o nome com acento e pontuação', () => {
      expect(
        SearchCompaniesQuerySchema.parse({ city: " Santa Bárbara d'Oeste " })
          .city,
      ).toBe("Santa Bárbara d'Oeste");
    });

    it('recusa o que não tem nenhuma letra ou dígito', () => {
      const result = parse({ city: '***' });

      expect(result.success).toBe(false);
      expect(result.error?.issues[0].path).toEqual(['city']);
    });

    it('recusa o nome com mais de 100 caracteres', () => {
      expect(parse({ city: 'a'.repeat(101) }).success).toBe(false);
    });
  });

  describe('CNAE', () => {
    it('aceita de 2 a 7 dígitos', () => {
      for (const cnae of ['62', '620', '6201', '62015', '620150', '6201501'])
        expect(SearchCompaniesQuerySchema.parse({ cnae }).cnae).toBe(cnae);
    });

    it('aceita a pontuação da máscara e a remove', () => {
      expect(SearchCompaniesQuerySchema.parse({ cnae: '6201-5/01' }).cnae).toBe(
        '6201501',
      );
      expect(SearchCompaniesQuerySchema.parse({ cnae: '62.01-5' }).cnae).toBe(
        '62015',
      );
    });

    it.each(['6', '62015011', 'abc', '62a', '62*'])('recusa %s', (cnae) => {
      expect(parse({ cnae }).success).toBe(false);
    });
  });

  describe('ODS e mínimos', () => {
    it('converte o ODS e os mínimos que vêm como texto', () => {
      expect(
        SearchCompaniesQuerySchema.parse({
          ods: '15',
          min_score: '-20.5',
          min_confidence: '0.6',
        }),
      ).toMatchObject({ ods: 15, min_score: -20.5, min_confidence: 0.6 });
    });

    it('aceita o mínimo zero (não é tratado como ausente)', () => {
      expect(
        SearchCompaniesQuerySchema.parse({
          ods: '13',
          min_score: '0',
          min_confidence: '0',
        }),
      ).toMatchObject({ min_score: 0, min_confidence: 0 });
    });

    it('mínimo em branco vale como não informado, e não como zero', () => {
      const parsed = SearchCompaniesQuerySchema.parse({
        ods: '13',
        min_score: '',
        min_confidence: ' ',
      });

      expect(parsed.min_score).toBeUndefined();
      expect(parsed.min_confidence).toBeUndefined();
    });

    it.each([
      [
        'índice mínimo sem ODS',
        { name: 'ambev', min_score: '10' },
        'min_score',
      ],
      [
        'confiança mínima sem ODS',
        { name: 'ambev', min_confidence: '0.5' },
        'min_confidence',
      ],
    ])('recusa %s', (_caso, query, field) => {
      const result = parse(query);

      expect(result.success).toBe(false);
      expect(result.error?.issues[0].path).toEqual([field]);
    });

    it.each([
      ['ODS 0', { ods: '0' }],
      ['ODS 18', { ods: '18' }],
      ['ODS fracionário', { ods: '1.5' }],
      ['ODS não numérico', { ods: 'x' }],
      ['índice acima de 100', { ods: '13', min_score: '100.1' }],
      ['índice abaixo de -100', { ods: '13', min_score: '-100.1' }],
      ['confiança acima de 1', { ods: '13', min_confidence: '1.1' }],
      ['confiança negativa', { ods: '13', min_confidence: '-0.1' }],
      ['índice não numérico', { ods: '13', min_score: 'alto' }],
    ])('recusa %s', (_caso, query) => {
      expect(parse(query).success).toBe(false);
    });

    it('aceita os extremos do índice e da confiança', () => {
      expect(
        parse({ ods: '13', min_score: '-100', min_confidence: '1' }).success,
      ).toBe(true);
      expect(parse({ ods: '17', min_score: '100' }).success).toBe(true);
    });
  });

  describe('ordenação pelo ODS', () => {
    it.each([
      ['asc', 'asc'],
      ['desc', 'desc'],
      ['ASC', 'asc'],
      [' Desc ', 'desc'],
    ])('aceita %j e devolve %s', (order, expected) => {
      expect(SearchCompaniesQuerySchema.parse({ ods: '15', order }).order).toBe(
        expected,
      );
    });

    it('exige o ODS selecionado', () => {
      const result = parse({ name: 'ambev', order: 'asc' });

      expect(result.success).toBe(false);
      expect(result.error?.issues[0].path).toEqual(['order']);
    });

    it.each(['up', 'ascendente', 'score', '1'])('recusa %j', (order) => {
      expect(parse({ ods: '15', order }).success).toBe(false);
    });

    it('em branco vale como não informado', () => {
      expect(
        SearchCompaniesQuerySchema.parse({ ods: '15', order: '  ' }).order,
      ).toBeUndefined();
    });
  });

  it('os critérios se combinam', () => {
    expect(
      SearchCompaniesQuerySchema.parse({
        name: 'ambev',
        uf: 'sp',
        city: 'São Paulo',
        cnae: '11',
        ods: '15',
        min_score: '-10',
        min_confidence: '0.3',
      }),
    ).toEqual({
      name: 'ambev',
      uf: 'SP',
      city: 'São Paulo',
      cnae: '11',
      ods: 15,
      min_score: -10,
      min_confidence: 0.3,
      page: 1,
      page_size: 20,
    });
  });
});

describe('SearchCompaniesResponseSchema', () => {
  const item = {
    cnpj: '11222333000181',
    legal_name: 'ACME LTDA',
    trade_name: null,
    registration_status: 'ATIVA',
    city: 'SAO PAULO',
    uf: 'SP',
    main_cnae: { code: '6201501', description: 'DESENVOLVIMENTO' },
    ods_score: null,
  };

  it('aceita a página com itens e a paginação', () => {
    expect(
      SearchCompaniesResponseSchema.safeParse({
        data: [item],
        pagination: { page: 1, page_size: 20, total: 1, total_pages: 1 },
      }).success,
    ).toBe(true);
  });

  it('o item traz o índice e a confiança do ODS selecionado, nulos sem cálculo', () => {
    const calculated = {
      ...item,
      ods_score: { ods_number: 15, score_value: -45, confidence_value: 0.62 },
    };
    const pending = {
      ...item,
      ods_score: { ods_number: 15, score_value: null, confidence_value: null },
    };

    expect(CompanySearchItemSchema.parse(calculated)).toEqual(calculated);
    expect(CompanySearchItemSchema.parse(pending)).toEqual(pending);
  });

  it('descarta o que não é declarado no item (nenhum dado além do cadastral)', () => {
    const parsed = CompanySearchItemSchema.parse({
      ...item,
      content_hash: 'segredo',
      address: { street: 'Rua X' },
    });

    expect(parsed).toEqual(item);
  });
});

describe('ExportCompaniesQuerySchema', () => {
  it('aceita os mesmos critérios da pesquisa e não traz paginação', () => {
    expect(
      ExportCompaniesQuerySchema.parse({
        name: 'ambev',
        uf: 'sp',
        city: 'São Paulo',
        cnae: '11',
        ods: '15',
        min_score: '-10',
        min_confidence: '0.3',
        order: 'DESC',
      }),
    ).toEqual({
      name: 'ambev',
      uf: 'SP',
      city: 'São Paulo',
      cnae: '11',
      ods: 15,
      min_score: -10,
      min_confidence: 0.3,
      order: 'desc',
    });
  });

  it('a paginação enviada é descartada: a exportação traz a lista inteira', () => {
    const parsed = ExportCompaniesQuerySchema.parse({
      uf: 'SP',
      page: '3',
      page_size: '10',
    });

    expect(parsed).not.toHaveProperty('page');
    expect(parsed).not.toHaveProperty('page_size');
  });

  it('exige ao menos um critério, como a pesquisa', () => {
    expect(ExportCompaniesQuerySchema.safeParse({}).success).toBe(false);
    expect(ExportCompaniesQuerySchema.safeParse({ page: '2' }).success).toBe(
      false,
    );
  });

  it('aplica as mesmas regras entre os critérios', () => {
    expect(
      ExportCompaniesQuerySchema.safeParse({ uf: 'SP', min_score: '1' })
        .success,
    ).toBe(false);
    expect(
      ExportCompaniesQuerySchema.safeParse({ uf: 'SP', order: 'asc' }).success,
    ).toBe(false);
    expect(ExportCompaniesQuerySchema.safeParse({ name: 'a b' }).success).toBe(
      false,
    );
  });
});

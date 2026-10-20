import {
  CompanySearchItemSchema,
  SearchCompaniesQuerySchema,
  SearchCompaniesResponseSchema,
} from './search-companies.dto.js';

describe('SearchCompaniesQuerySchema', () => {
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

  it('exige o nome', () => {
    expect(SearchCompaniesQuerySchema.safeParse({}).success).toBe(false);
  });

  it('recusa o nome vazio ou só de espaços', () => {
    expect(SearchCompaniesQuerySchema.safeParse({ name: '' }).success).toBe(
      false,
    );
    expect(SearchCompaniesQuerySchema.safeParse({ name: '   ' }).success).toBe(
      false,
    );
  });

  it('recusa quando nenhuma palavra tem 3 caracteres ou mais', () => {
    const result = SearchCompaniesQuerySchema.safeParse({ name: 'a b do' });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0].message).toMatch(/3 letras ou mais/);
  });

  it('aceita palavras curtas junto de uma significativa', () => {
    expect(
      SearchCompaniesQuerySchema.safeParse({ name: 'banco do brasil s a' })
        .success,
    ).toBe(true);
  });

  it('recusa o texto que passa de 100 caracteres', () => {
    expect(
      SearchCompaniesQuerySchema.safeParse({ name: 'a'.repeat(101) }).success,
    ).toBe(false);
    expect(
      SearchCompaniesQuerySchema.safeParse({ name: 'a'.repeat(100) }).success,
    ).toBe(true);
  });

  it('recusa paginação fora dos limites', () => {
    const name = 'petrobras';

    expect(
      SearchCompaniesQuerySchema.safeParse({ name, page: '0' }).success,
    ).toBe(false);
    expect(
      SearchCompaniesQuerySchema.safeParse({ name, page_size: '101' }).success,
    ).toBe(false);
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
  };

  it('aceita a página com itens e a paginação', () => {
    expect(
      SearchCompaniesResponseSchema.safeParse({
        data: [item],
        pagination: { page: 1, page_size: 20, total: 1, total_pages: 1 },
      }).success,
    ).toBe(true);
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

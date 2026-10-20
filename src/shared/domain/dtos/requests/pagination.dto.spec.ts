import { buildPaginationMeta, paginatedSchema } from './pagination.dto.js';
import { z } from 'zod';

describe('buildPaginationMeta', () => {
  it('arredonda o total de páginas para cima', () => {
    expect(buildPaginationMeta({ page: 2, page_size: 20 }, 41)).toEqual({
      page: 2,
      page_size: 20,
      total: 41,
      total_pages: 3,
    });
  });

  it('total múltiplo do tamanho da página não cria página extra', () => {
    expect(
      buildPaginationMeta({ page: 1, page_size: 20 }, 40).total_pages,
    ).toBe(2);
  });

  it('sem itens, não há páginas', () => {
    expect(buildPaginationMeta({ page: 1, page_size: 20 }, 0).total_pages).toBe(
      0,
    );
  });
});

describe('paginatedSchema', () => {
  const schema = paginatedSchema(z.object({ id: z.string() }));

  it('aceita itens e paginação', () => {
    expect(
      schema.safeParse({
        data: [{ id: 'a' }],
        pagination: { page: 1, page_size: 20, total: 1, total_pages: 1 },
      }).success,
    ).toBe(true);
  });

  it('recusa sem a paginação', () => {
    expect(schema.safeParse({ data: [] }).success).toBe(false);
  });
});

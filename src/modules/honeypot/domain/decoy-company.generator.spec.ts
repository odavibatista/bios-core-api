import { parseCnpj } from '@shared/domain/value-objects/cnpj.js';
import { DecoyCompanyGenerator } from './decoy-company.generator.js';
import {
  DecoyCompanyListQuerySchema,
  DecoyCompanyParamsSchema,
  DecoyCompanySchema,
} from './dtos/requests/decoy-company.dto.js';

describe('dados sintéticos das iscas (#88)', () => {
  const generator = new DecoyCompanyGenerator();

  it('a empresa do CNPJ é plausível, no formato declarado, e sempre a mesma', () => {
    const company = generator.company('11222333000181');

    expect(DecoyCompanySchema.parse(company)).toEqual(company);
    expect(company.cnpj).toBe('11222333000181');
    expect(company.address.uf).toMatch(/^[A-Z]{2}$/);
    expect(company.main_cnae.code).toMatch(/^\d{7}$/);
    expect(generator.company('11222333000181')).toEqual(company);
    expect(generator.company('33000167000101')).not.toEqual(company);
  });

  it('a página tem o tamanho pedido, CNPJs válidos e distintos, e é sempre a mesma', () => {
    const { items, total } = generator.page(2, 10);

    expect(items).toHaveLength(10);
    expect(total).toBeGreaterThan(1_000);
    expect(new Set(items.map(({ cnpj }) => cnpj)).size).toBe(10);
    for (const { cnpj } of items) expect(parseCnpj(cnpj)).toBe(cnpj);
    expect(generator.page(2, 10).items).toEqual(items);
    expect(generator.page(3, 10).items).not.toEqual(items);
  });

  it('além do fim, a página vem vazia', () => {
    const { total } = generator.page(1, 1);

    expect(generator.page(Math.ceil(total / 10) + 1, 10).items).toEqual([]);
    expect(
      generator.page(Math.ceil(total / 10), 10).items.length,
    ).toBeLessThanOrEqual(10);
  });

  it('a semente da isca não mexe na sorte de mais ninguém (instância própria do Faker)', async () => {
    const { faker } = await import('@faker-js/faker');
    faker.seed(42);
    const expected = faker.number.int();

    faker.seed(42);
    generator.company('11222333000181');

    expect(faker.number.int()).toBe(expected);
  });

  describe('entrada', () => {
    it.each([
      [{}, { page: 1, page_size: 10 }],
      [
        { page: '4', page_size: '50' },
        { page: 4, page_size: 10 },
      ],
      [{ page_size: '3' }, { page: 1, page_size: 3 }],
    ])('página %j vira %j (no máximo 10 itens)', (query, expected) => {
      expect(DecoyCompanyListQuerySchema.parse(query)).toEqual(expected);
    });

    it.each([{ page: '0' }, { page_size: '0' }, { page: 'x' }])(
      'recusa %j',
      (query) => {
        expect(DecoyCompanyListQuerySchema.safeParse(query).success).toBe(
          false,
        );
      },
    );

    it('CNPJ do detalhe: canônico quando válido, recusado quando não', () => {
      expect(
        DecoyCompanyParamsSchema.parse({ cnpj: '11.222.333/0001-81' }),
      ).toEqual({ cnpj: '11222333000181' });
      expect(
        DecoyCompanyParamsSchema.safeParse({ cnpj: '11222333000182' }).success,
      ).toBe(false);
    });
  });
});

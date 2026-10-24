import { z } from 'zod';
import { JsonValueSchema } from './json-value.dto.js';

describe('JsonValueSchema', () => {
  it.each([
    ['texto', 'abc'],
    ['número', 12.5],
    ['zero', 0],
    ['booleano', false],
    ['nulo', null],
    ['lista', [1, 'a', null, [true]]],
    ['objeto', { a: 1, b: { c: ['x'] } }],
    ['lista vazia', []],
    ['objeto vazio', {}],
  ])('aceita %s', (_label, value) => {
    expect(JsonValueSchema.safeParse(value).success).toBe(true);
  });

  it('aceita aninhamento profundo', () => {
    let value: unknown = 'fim';

    for (let level = 0; level < 40; level += 1) value = { filho: [value] };

    expect(JsonValueSchema.safeParse(value).success).toBe(true);
  });

  it.each([
    ['undefined', undefined],
    ['função', () => 1],
    ['data', new Date()],
    ['símbolo', Symbol('x')],
    ['objeto com valor inválido', { a: undefined }],
    ['lista com valor inválido', [1, () => 2]],
  ])('recusa %s', (_label, value) => {
    expect(JsonValueSchema.safeParse(value).success).toBe(false);
  });

  it('devolve o valor sem alterá-lo', () => {
    const value = { a: [1, { b: null }], c: 'x' };

    expect(JsonValueSchema.parse(value)).toEqual(value);
  });

  it('vira o componente JsonValue no OpenAPI, sem o nome automático', () => {
    const schema = JSON.stringify(
      JsonValueSchema['~standard' as keyof typeof JsonValueSchema],
    );
    const generated = JSON.stringify(
      z.toJSONSchema(JsonValueSchema, { target: 'openapi-3.0' }),
    );

    expect(schema).toBeDefined();
    expect(generated).toContain('JsonValue');
    expect(generated).not.toContain('__schema');
  });
});

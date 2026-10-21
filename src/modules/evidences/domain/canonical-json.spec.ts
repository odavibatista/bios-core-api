import { canonicalJson, contentHash } from './canonical-json.js';

describe('canonicalJson', () => {
  it('a ordem em que as chaves foram escritas não muda o texto', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it('vale em todos os níveis, inclusive dentro de listas', () => {
    expect(canonicalJson({ z: [{ b: 1, a: 2 }], a: { y: 1, x: 2 } })).toBe(
      '{"a":{"x":2,"y":1},"z":[{"a":2,"b":1}]}',
    );
  });

  it('a ordem dos itens de uma lista é parte do conteúdo', () => {
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  });

  it('valores simples e nulo passam como JSON', () => {
    expect(canonicalJson('texto')).toBe('"texto"');
    expect(canonicalJson(null)).toBe('null');
    expect(canonicalJson({ a: null })).toBe('{"a":null}');
  });
});

describe('contentHash', () => {
  it('é um SHA-256 em hexadecimal', () => {
    expect(contentHash({ a: 1 })).toMatch(/^[0-9a-f]{64}$/);
  });

  it('o mesmo conteúdo tem o mesmo resumo, qualquer que seja a ordem das chaves', () => {
    expect(contentHash({ a: 1, b: { c: 2, d: 3 } })).toBe(
      contentHash({ b: { d: 3, c: 2 }, a: 1 }),
    );
  });

  it('conteúdo diferente tem resumo diferente', () => {
    expect(contentHash({ a: 1 })).not.toBe(contentHash({ a: 2 }));
    expect(contentHash({ a: 1 })).not.toBe(contentHash({ b: 1 }));
  });
});

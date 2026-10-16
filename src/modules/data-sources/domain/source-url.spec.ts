import { buildSourceUrl } from './source-url.js';

describe('buildSourceUrl', () => {
  it('acrescenta os segmentos ao caminho da URL base', () => {
    expect(
      buildSourceUrl('https://brasilapi.com.br/api/cnpj/v1', [
        '11222333000181',
      ]),
    ).toBe('https://brasilapi.com.br/api/cnpj/v1/11222333000181');
  });

  it('aceita URL base sem caminho', () => {
    expect(buildSourceUrl('https://minhareceita.org', ['11222333000181'])).toBe(
      'https://minhareceita.org/11222333000181',
    );
  });

  it('ignora a barra final da URL base', () => {
    expect(buildSourceUrl('https://api.opencnpj.org/', ['123'])).toBe(
      'https://api.opencnpj.org/123',
    );
    expect(buildSourceUrl('https://x.test/api///', ['123'])).toBe(
      'https://x.test/api/123',
    );
  });

  it('junta vários segmentos', () => {
    expect(
      buildSourceUrl('https://x.test/api', ['cnae', 'classes', '6201']),
    ).toBe('https://x.test/api/cnae/classes/6201');
  });

  it('sem segmentos, devolve a própria base', () => {
    expect(buildSourceUrl('https://x.test/api', [])).toBe('https://x.test/api');
  });

  it('acrescenta os parâmetros de consulta, codificados', () => {
    expect(
      buildSourceUrl('https://x.test/api', ['ceis'], {
        cnpjSancionado: '11222333000181',
        nome: 'Ação & Cia',
      }),
    ).toBe(
      'https://x.test/api/ceis?cnpjSancionado=11222333000181&nome=A%C3%A7%C3%A3o+%26+Cia',
    );
  });

  it('não escapa do caminho da fonte: o segmento é valor, não caminho', () => {
    const url = buildSourceUrl('https://x.test/api/cnpj', [
      '../../admin',
      'a/b',
      'q?x=1#y',
    ]);

    expect(url).toBe(
      'https://x.test/api/cnpj/..%2F..%2Fadmin/a%2Fb/q%3Fx%3D1%23y',
    );
    expect(new URL(url).pathname.startsWith('/api/cnpj/')).toBe(true);
  });

  it('aceita http, para fontes locais e testes', () => {
    expect(buildSourceUrl('http://127.0.0.1:8080', ['x'])).toBe(
      'http://127.0.0.1:8080/x',
    );
  });

  it.each([
    ['sem protocolo', 'brasilapi.com.br/api'],
    ['vazia', ''],
    ['de outro protocolo', 'file:///etc/passwd'],
    ['ftp', 'ftp://x.test/dados'],
  ])('recusa URL base %s', (_case, baseUrl) => {
    expect(() => buildSourceUrl(baseUrl, ['x'])).toThrow();
  });
});

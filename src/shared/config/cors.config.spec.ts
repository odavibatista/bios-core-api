import { buildCorsOptions, CORS_EXPOSED_HEADERS } from './cors.config.js';

describe('buildCorsOptions', () => {
  it('qualquer origem quando CORS_ORIGINS é "*"', () => {
    expect(buildCorsOptions(true)).toEqual({
      origin: true,
      exposedHeaders: CORS_EXPOSED_HEADERS,
    });
  });

  it('só as origens informadas', () => {
    expect(buildCorsOptions(['http://localhost:4200']).origin).toEqual([
      'http://localhost:4200',
    ]);
  });

  it('expõe o nome do arquivo da exportação e o prazo do 429', () => {
    expect(CORS_EXPOSED_HEADERS).toEqual([
      'Content-Disposition',
      'Retry-After',
    ]);
  });
});

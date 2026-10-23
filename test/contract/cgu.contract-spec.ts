import { CGU_SLUGS, readCguPage } from '@modules/cgu/domain/cgu-sanction.js';
import { callSource, secretOrNull, seededBaseUrl } from './support.js';

/** CNPJ válido de teste: a leitura confere a forma da página, não procura sanção. */
const PROBE_CNPJ = '00000000000191';
const HEADER = 'chave-api-dados';
const key = secretOrNull('CGU_API_KEY');

describe.runIf(key !== null).each(CGU_SLUGS)('contrato da CGU: %s', (slug) => {
  const page = (number: number, credential: string | null) =>
    callSource(`${seededBaseUrl(slug)}?pagina=${number}`, {
      headers: credential ? { [HEADER]: credential } : {},
    });

  it('responde 200 em JSON com a credencial no cabeçalho esperado', async () => {
    const response = await page(1, key);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type') ?? '').toMatch(/json/i);
  });

  it('entrega páginas de sanções que o leitor aceita', async () => {
    const body: unknown = await (await page(1, key)).json();

    expect(Array.isArray(body)).toBe(true);
    expect((body as unknown[]).length).toBeGreaterThan(0);
    // Valida cada linha (documento, datas, campos); lança se o formato mudou.
    const { ids } = readCguPage(body, PROBE_CNPJ);

    expect(ids).toHaveLength((body as unknown[]).length);
  });

  it('pagina: a página 2 traz registros diferentes dos da página 1', async () => {
    const first = readCguPage(await (await page(1, key)).json(), PROBE_CNPJ);
    const second = readCguPage(await (await page(2, key)).json(), PROBE_CNPJ);

    expect(second.ids.length).toBeGreaterThan(0);
    expect(second.ids.join()).not.toBe(first.ids.join());
  });

  it('recusa a chamada sem credencial', async () => {
    const response = await page(1, null);

    expect([401, 403]).toContain(response.status);
  });
});

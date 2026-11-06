import { readPostalAddress } from '@modules/viacep/domain/viacep.mapper.js';
import { callSource, joinUrl, seededBaseUrl } from './support.js';

/** CEP da Avenida Paulista: endereço estável, usado só para conferir o formato. */
const PROBE_CEP = '01310200';
/** CEP bem formado que não existe. */
const ABSENT_CEP = '00000000';

describe('contrato do ViaCEP', () => {
  const lookup = (cep: string) =>
    callSource(joinUrl(seededBaseUrl('VIACEP'), [cep, 'json']));

  it('responde 200 em JSON', async () => {
    const response = await lookup(PROBE_CEP);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type') ?? '').toMatch(/json/i);
  });

  it('entrega um endereço que o leitor aceita, com o código IBGE', async () => {
    const body: unknown = await (await lookup(PROBE_CEP)).json();

    expect(readPostalAddress(body, PROBE_CEP)).toMatchObject({
      kind: 'FOUND',
      value: {
        state: 'SP',
        city: 'São Paulo',
        cityIbgeCode: '3550308',
      },
    });
  });

  it('marca o CEP inexistente de um jeito que o leitor entende', async () => {
    const body: unknown = await (await lookup(ABSENT_CEP)).json();

    expect(readPostalAddress(body, ABSENT_CEP)).toEqual({ kind: 'ABSENT' });
  });
});

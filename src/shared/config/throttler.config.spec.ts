import type { ConfigService } from '@nestjs/config';
import { Duration } from '../domain/value-objects/duration.js';
import { faker } from '@test/support/faker.js';
import type { Environment } from './environment.config.js';
import {
  API_KEY_HEADER,
  apiKeyOf,
  buildThrottlers,
  ThrottlerName,
} from './throttler.config.js';

/** Configuração com janelas e limites conhecidos. */
function configOf(
  values: Partial<Environment>,
): ConfigService<Environment, true> {
  return {
    get: (key: keyof Environment) => values[key],
  } as unknown as ConfigService<Environment, true>;
}

const ENVIRONMENT: Partial<Environment> = {
  THROTTLE_TTL: Duration.parse('1m'),
  THROTTLE_LIMIT: 120,
  THROTTLE_PUBLIC_API_TTL: Duration.parse('30s'),
  THROTTLE_PUBLIC_API_LIMIT: 60,
};

describe('configuração do limite de requisições', () => {
  describe('chave de API na requisição', () => {
    it('lê o cabeçalho acordado', () => {
      const key = faker.string.alphanumeric(32);

      expect(apiKeyOf({ headers: { [API_KEY_HEADER]: key } })).toBe(key);
    });

    it('descarta espaços nas bordas', () => {
      const key = faker.string.alphanumeric(32);

      expect(apiKeyOf({ headers: { [API_KEY_HEADER]: `  ${key} ` } })).toBe(
        key,
      );
    });

    it.each([
      ['ausente', {}],
      ['vazio', { [API_KEY_HEADER]: '   ' }],
      ['repetido (lista)', { [API_KEY_HEADER]: ['a', 'b'] }],
    ])('devolve undefined quando o cabeçalho está %s', (_case, headers) => {
      expect(apiKeyOf({ headers })).toBeUndefined();
    });
  });

  describe('limites declarados', () => {
    const throttlers = buildThrottlers(configOf(ENVIRONMENT));

    it('declara o limite geral e o da API pública', () => {
      expect(throttlers.map(({ name }) => name)).toEqual([
        ThrottlerName.DEFAULT,
        ThrottlerName.PUBLIC_API,
      ]);
    });

    it('converte a janela de duração para milissegundos, como a biblioteca espera', () => {
      expect(throttlers).toMatchObject([
        { ttl: 60_000, limit: 120 },
        { ttl: 30_000, limit: 60 },
      ]);
    });

    it('conta o limite geral pelo endereço, sem chave de rastreio própria', () => {
      expect(throttlers[0].getTracker).toBeUndefined();
    });

    describe('chave de rastreio da API pública', () => {
      const { getTracker } = throttlers[1];

      /** A biblioteca aceita chave de rastreio síncrona ou assíncrona. */
      const track = (request: Record<string, unknown>) =>
        getTracker?.(request, {} as never);

      it('usa a chave de API, para cada integrador ter a própria cota', async () => {
        const key = faker.string.alphanumeric(32);

        expect(
          await track({ headers: { [API_KEY_HEADER]: key }, ip: '10.0.0.1' }),
        ).toBe(key);
      });

      it('recorre ao endereço de quem ainda não se identificou', async () => {
        const ip = faker.internet.ipv4();

        expect(await track({ headers: {}, ip })).toBe(ip);
      });

      it('não quebra sem endereço nem chave', async () => {
        expect(await track({ headers: {} })).toBe('desconhecido');
      });
    });
  });
});

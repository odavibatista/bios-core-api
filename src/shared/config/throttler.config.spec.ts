import { Controller, Get, type ExecutionContext } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Duration } from '../domain/value-objects/duration.js';
import { PublicApiRoute } from '../http/decorators/public-api-route.decorator.js';
import { faker } from '@test/support/faker.js';
import type { Environment } from './environment.config.js';
import {
  API_KEY_HEADER,
  apiKeyOf,
  buildThrottlers,
  ThrottlerName,
} from './throttler.config.js';

@Controller()
class ProbeController {
  @PublicApiRoute()
  @Get('publica')
  publicApi(): void {}

  @Get('interna')
  internal(): void {}
}

@PublicApiRoute()
@Controller()
class PublicApiProbeController {
  @Get('qualquer')
  any(): void {}
}

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

      it('dá a cada chave de API o próprio contador, mesmo vindo do mesmo endereço', async () => {
        const [first, second] = faker.helpers.uniqueArray(
          () => faker.string.alphanumeric(32),
          2,
        );
        const ip = '10.0.0.1';

        const firstTracker = await track({
          headers: { [API_KEY_HEADER]: first },
          ip,
        });
        const secondTracker = await track({
          headers: { [API_KEY_HEADER]: second },
          ip,
        });

        expect(firstTracker).not.toBe(secondTracker);
        expect(firstTracker).not.toBe(ip);
      });

      it('conta a mesma chave sempre no mesmo contador', async () => {
        const key = faker.string.alphanumeric(32);
        const headers = { [API_KEY_HEADER]: key };

        expect(await track({ headers, ip: '10.0.0.1' })).toBe(
          await track({
            headers: { [API_KEY_HEADER]: ` ${key} ` },
            ip: '10.0.0.2',
          }),
        );
      });

      it('não leva o segredo da chave ao Redis: o rastreio é um resumo', async () => {
        const key = faker.string.alphanumeric(48);

        const tracker = await track({ headers: { [API_KEY_HEADER]: key } });

        expect(tracker).toMatch(/^key:[0-9a-f]{32}$/);
        expect(String(tracker)).not.toContain(key);
      });

      it('recorre ao endereço de quem ainda não se identificou', async () => {
        const ip = faker.internet.ipv4();

        expect(await track({ headers: {}, ip })).toBe(ip);
      });

      it('não quebra sem endereço nem chave', async () => {
        expect(await track({ headers: {} })).toBe('desconhecido');
      });
    });

    describe('escopo do limite da API pública', () => {
      const { skipIf } = throttlers[1];

      /** Contexto mínimo: o limite só consulta o método e a classe do endpoint. */
      const contextOf = (controller: new () => object, method: string) =>
        ({
          getHandler: () =>
            (controller.prototype as Record<string, () => void>)[method],
          getClass: () => controller,
        }) as unknown as ExecutionContext;

      it('incide no endpoint marcado como API pública', () => {
        expect(skipIf?.(contextOf(ProbeController, 'publicApi'))).toBe(false);
      });

      it('incide em todos os endpoints de um controller marcado', () => {
        expect(skipIf?.(contextOf(PublicApiProbeController, 'any'))).toBe(
          false,
        );
      });

      it('é dispensado no endpoint interno', () => {
        expect(skipIf?.(contextOf(ProbeController, 'internal'))).toBe(true);
      });

      it('o limite geral não é dispensado em lugar nenhum', () => {
        expect(throttlers[0].skipIf).toBeUndefined();
      });
    });
  });
});

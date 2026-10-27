import { Controller, Get, type ExecutionContext } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Duration } from '../domain/value-objects/duration.js';
import { PublicApiRoute } from '../http/decorators/public-api-route.decorator.js';
import { RouteRateLimit } from '../http/decorators/route-rate-limit.decorator.js';
import { faker } from '@test/support/faker.js';
import type { Environment } from './environment.config.js';
import {
  API_KEY_HEADER,
  apiKeyOf,
  buildThrottlers,
  ROUTE_THROTTLERS,
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

@Controller()
class RouteLimitProbeController {
  @RouteRateLimit(ThrottlerName.COMPANY_PROFILE)
  @Get('perfil')
  profile(): void {}

  @RouteRateLimit(ThrottlerName.COMPANY_EXPORT)
  @Get('exportacao')
  exportation(): void {}

  @Get('livre')
  free(): void {}
}

@RouteRateLimit(ThrottlerName.COMPANY_SEARCH)
@Controller()
class SearchLimitProbeController {
  @Get('busca')
  search(): void {}
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
  THROTTLE_COMPANY_PROFILE_LIMIT: 61,
  THROTTLE_COMPANY_EVIDENCES_LIMIT: 22,
  THROTTLE_COMPANY_SEARCH_LIMIT: 63,
  THROTTLE_COMPANY_EXPORT_LIMIT: 14,
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

    it('declara o limite geral, o da API pública e um por rota de empresa', () => {
      expect(throttlers.map(({ name }) => name)).toEqual([
        ThrottlerName.DEFAULT,
        ThrottlerName.PUBLIC_API,
        ThrottlerName.COMPANY_PROFILE,
        ThrottlerName.COMPANY_EVIDENCES,
        ThrottlerName.COMPANY_SEARCH,
        ThrottlerName.COMPANY_EXPORT,
      ]);
    });

    it('converte a janela de duração para milissegundos, como a biblioteca espera', () => {
      expect(throttlers.slice(0, 2)).toMatchObject([
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

  describe('limites próprios das rotas de empresa', () => {
    const throttlers = buildThrottlers(configOf(ENVIRONMENT));
    const byName = (name: string) =>
      throttlers.find((throttler) => throttler.name === name)!;

    /** Contexto mínimo: o limite só consulta o método e a classe do endpoint. */
    const contextOf = (controller: new () => object, method: string) =>
      ({
        getHandler: () =>
          (controller.prototype as Record<string, () => void>)[method],
        getClass: () => controller,
      }) as unknown as ExecutionContext;

    it.each([
      [ThrottlerName.COMPANY_PROFILE, 61],
      [ThrottlerName.COMPANY_EVIDENCES, 22],
      [ThrottlerName.COMPANY_SEARCH, 63],
      [ThrottlerName.COMPANY_EXPORT, 14],
    ])(
      'o limite %s vem da variável de ambiente (%i) e usa a janela geral',
      (name, limit) => {
        expect(byName(name)).toMatchObject({ limit, ttl: 60_000 });
      },
    );

    it('cada limite tem a variável própria declarada', () => {
      expect(ROUTE_THROTTLERS).toEqual({
        companyProfile: 'THROTTLE_COMPANY_PROFILE_LIMIT',
        companyEvidences: 'THROTTLE_COMPANY_EVIDENCES_LIMIT',
        companySearch: 'THROTTLE_COMPANY_SEARCH_LIMIT',
        companyExport: 'THROTTLE_COMPANY_EXPORT_LIMIT',
      });
    });

    it('segue a janela geral quando ela muda', () => {
      const custom = buildThrottlers(
        configOf({ ...ENVIRONMENT, THROTTLE_TTL: Duration.parse('5m') }),
      );

      expect(
        custom.find(({ name }) => name === ThrottlerName.COMPANY_PROFILE)?.ttl,
      ).toBe(300_000);
    });

    it('conta por endereço, sem chave de rastreio própria', () => {
      for (const name of Object.keys(ROUTE_THROTTLERS)) {
        expect(byName(name).getTracker).toBeUndefined();
      }
    });

    it('incide só na rota que declara o limite, e não nas demais', () => {
      const profile = byName(ThrottlerName.COMPANY_PROFILE);
      const exportation = byName(ThrottlerName.COMPANY_EXPORT);
      const profileContext = contextOf(RouteLimitProbeController, 'profile');
      const exportContext = contextOf(RouteLimitProbeController, 'exportation');
      const freeContext = contextOf(RouteLimitProbeController, 'free');

      expect(profile.skipIf?.(profileContext)).toBe(false);
      expect(profile.skipIf?.(exportContext)).toBe(true);
      expect(profile.skipIf?.(freeContext)).toBe(true);
      expect(exportation.skipIf?.(exportContext)).toBe(false);
      expect(exportation.skipIf?.(profileContext)).toBe(true);
    });

    it('um controller marcado leva o limite a todas as suas rotas', () => {
      const context = contextOf(SearchLimitProbeController, 'search');

      expect(byName(ThrottlerName.COMPANY_SEARCH).skipIf?.(context)).toBe(
        false,
      );
      expect(byName(ThrottlerName.COMPANY_PROFILE).skipIf?.(context)).toBe(
        true,
      );
    });

    it('a API pública não é afetada por estes limites', () => {
      expect(
        byName(ThrottlerName.PUBLIC_API).skipIf?.(
          contextOf(RouteLimitProbeController, 'profile'),
        ),
      ).toBe(true);
    });
  });
});

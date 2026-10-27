import { Controller, Get } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ThrottlerName } from '../../config/throttler.config.js';
import {
  ROUTE_RATE_LIMIT,
  RouteRateLimit,
} from './route-rate-limit.decorator.js';

@Controller()
class ProbeController {
  @RouteRateLimit(ThrottlerName.COMPANY_PROFILE)
  @Get('perfil')
  profile(): void {}

  @Get('livre')
  free(): void {}
}

@RouteRateLimit(ThrottlerName.COMPANY_SEARCH)
@Controller()
class ClassProbeController {
  @Get('busca')
  search(): void {}
}

describe('RouteRateLimit', () => {
  const reflector = new Reflector();

  it('declara o limite próprio do método', () => {
    expect(
      reflector.get<string>(
        ROUTE_RATE_LIMIT,
        ProbeController.prototype.profile,
      ),
    ).toBe(ThrottlerName.COMPANY_PROFILE);
  });

  it('não declara limite no método sem o decorator', () => {
    expect(
      reflector.get<string | undefined>(
        ROUTE_RATE_LIMIT,
        ProbeController.prototype.free,
      ),
    ).toBeUndefined();
  });

  it('o decorator no controller vale para todos os seus endpoints', () => {
    expect(reflector.get<string>(ROUTE_RATE_LIMIT, ClassProbeController)).toBe(
      ThrottlerName.COMPANY_SEARCH,
    );
  });

  it('dispensa o limite geral na rota marcada, e só nela', () => {
    expect(
      reflector.get<boolean | undefined>(
        'THROTTLER:SKIPdefault',
        ProbeController.prototype.profile,
      ),
    ).toBe(true);
    expect(
      reflector.get<boolean | undefined>(
        'THROTTLER:SKIPdefault',
        ProbeController.prototype.free,
      ),
    ).toBeUndefined();
  });
});

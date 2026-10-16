import { Controller, Get } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  IS_PUBLIC_API_ROUTE,
  PublicApiRoute,
} from './public-api-route.decorator.js';

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

describe('PublicApiRoute', () => {
  const reflector = new Reflector();

  it('marca o método como API pública', () => {
    expect(
      reflector.get<boolean>(
        IS_PUBLIC_API_ROUTE,
        ProbeController.prototype.publicApi,
      ),
    ).toBe(true);
  });

  it('não marca o método sem o decorator: o limite da API pública não incide', () => {
    expect(
      reflector.get<boolean | undefined>(
        IS_PUBLIC_API_ROUTE,
        ProbeController.prototype.internal,
      ),
    ).toBeUndefined();
  });

  it('marca todos os endpoints quando aplicado ao controller', () => {
    expect(
      reflector.get<boolean>(IS_PUBLIC_API_ROUTE, PublicApiProbeController),
    ).toBe(true);
  });
});

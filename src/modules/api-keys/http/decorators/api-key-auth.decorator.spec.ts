import { Controller, Get } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants.js';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_API_ROUTE } from '@shared/http/decorators/public-api-route.decorator.js';
import { IS_PUBLIC_ROUTE } from '@shared/http/decorators/public.decorator.js';
import { ApiKeyGuard } from '../guards/api-key.guard.js';
import { ApiKeyAuth } from './api-key-auth.decorator.js';

@ApiKeyAuth()
@Controller()
class ProbeController {
  @Get('qualquer')
  any(): void {}
}

describe('ApiKeyAuth', () => {
  const reflector = new Reflector();

  it('dispensa a sessão: o guard global não se aplica a integradores', () => {
    expect(reflector.get<boolean>(IS_PUBLIC_ROUTE, ProbeController)).toBe(true);
  });

  it('faz valer o limite de requisições por chave', () => {
    expect(reflector.get<boolean>(IS_PUBLIC_API_ROUTE, ProbeController)).toBe(
      true,
    );
  });

  it('exige a chave de API pelo guard próprio', () => {
    expect(
      reflector.get<unknown[]>(GUARDS_METADATA, ProbeController),
    ).toContain(ApiKeyGuard);
  });
});

import { Controller, Get } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_ROUTE, Public } from './public.decorator.js';

@Controller()
class ProbeController {
  @Public()
  @Get('aberta')
  open(): void {}

  @Get('fechada')
  closed(): void {}
}

@Public()
@Controller()
class OpenProbeController {
  @Get('qualquer')
  any(): void {}
}

describe('Public', () => {
  const reflector = new Reflector();

  it('marca o método como público', () => {
    expect(
      reflector.get<boolean>(IS_PUBLIC_ROUTE, ProbeController.prototype.open),
    ).toBe(true);
  });

  it('não marca o método sem o decorator: o padrão é exigir login', () => {
    expect(
      reflector.get<boolean | undefined>(
        IS_PUBLIC_ROUTE,
        ProbeController.prototype.closed,
      ),
    ).toBeUndefined();
  });

  it('marca todos os endpoints quando aplicado ao controller', () => {
    expect(reflector.get<boolean>(IS_PUBLIC_ROUTE, OpenProbeController)).toBe(
      true,
    );
  });
});

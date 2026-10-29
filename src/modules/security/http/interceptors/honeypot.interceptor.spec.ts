import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { faker } from '@test/support/faker.js';
import { firstValueFrom, of } from 'rxjs';
import { IS_PUBLIC_ROUTE } from '@shared/http/decorators/public.decorator.js';
import type { RegisterHoneypotHitUseCase } from '../../infra/usecases/register-honeypot-hit.usecase.js';
import {
  Honeypot,
  IS_HONEYPOT_ROUTE,
} from '../decorators/honeypot.decorator.js';
import { HoneypotInterceptor } from './honeypot.interceptor.js';

describe('@Honeypot() e HoneypotInterceptor (#87)', () => {
  const register = { execute: vi.fn<RegisterHoneypotHitUseCase['execute']>() };
  const interceptor = new HoneypotInterceptor(
    register as unknown as RegisterHoneypotHitUseCase,
  );

  function contextOf(request: Record<string, unknown>): ExecutionContext {
    return {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
  }

  function handler(order: string[]): CallHandler {
    return {
      handle: () => {
        order.push('isca');
        return of('resposta');
      },
    };
  }

  it('registra antes de a isca responder, e devolve a resposta dela', async () => {
    const order: string[] = [];
    // O registro só termina depois de esperar (banco e Redis): a isca tem de aguardá-lo.
    register.execute.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      order.push('registro');
      return 'BLOCKED';
    });
    const userAgent = faker.internet.userAgent();

    const result = await firstValueFrom(
      interceptor.intercept(
        contextOf({
          ip: '203.0.113.7',
          method: 'GET',
          originalUrl: '/v2/companies?page=2&page_size=10',
          headers: { 'user-agent': userAgent },
        }),
        handler(order),
      ),
    );

    expect(result).toBe('resposta');
    expect(order).toEqual(['registro', 'isca']);
    expect(register.execute).toHaveBeenCalledWith({
      ip: '203.0.113.7',
      endpoint: '/v2/companies',
      httpMethod: 'GET',
      userAgent,
    });
  });

  it('falha no registro não muda a resposta da isca (NFSE07)', async () => {
    register.execute.mockRejectedValue(new Error('banco fora'));

    await expect(
      firstValueFrom(
        interceptor.intercept(
          contextOf({
            ip: '203.0.113.7',
            method: 'GET',
            originalUrl: '/v2/companies',
            headers: {},
          }),
          handler([]),
        ),
      ),
    ).resolves.toBe('resposta');
  });

  it('sem IP conhecido, não registra', async () => {
    await firstValueFrom(
      interceptor.intercept(
        contextOf({ method: 'GET', originalUrl: '/v2/companies', headers: {} }),
        handler([]),
      ),
    );

    expect(register.execute).not.toHaveBeenCalled();
  });

  it('corta caminho e user-agent longos, e user-agent ausente vira null', async () => {
    await firstValueFrom(
      interceptor.intercept(
        contextOf({
          ip: '203.0.113.7',
          method: 'GET',
          originalUrl: `/v2/${'x'.repeat(2_000)}`,
          headers: { 'user-agent': ['a', 'b'] },
        }),
        handler([]),
      ),
    );

    const [{ endpoint, userAgent }] = register.execute.mock.calls[0];
    expect(endpoint).toHaveLength(512);
    expect(userAgent).toBeNull();

    register.execute.mockClear();
    await firstValueFrom(
      interceptor.intercept(
        contextOf({
          ip: '203.0.113.7',
          method: 'GET',
          originalUrl: '/v2/companies',
          headers: { 'user-agent': 'y'.repeat(2_000) },
        }),
        handler([]),
      ),
    );
    expect(register.execute.mock.calls[0][0].userAgent).toHaveLength(512);
  });

  it('o decorator torna a rota pública e a marca como isca', () => {
    class Decoy {
      @Honeypot()
      route(): void {}
    }
    const reflector = new Reflector();

    expect(reflector.get(IS_PUBLIC_ROUTE, Decoy.prototype.route)).toBe(true);
    expect(reflector.get(IS_HONEYPOT_ROUTE, Decoy.prototype.route)).toBe(true);
  });
});

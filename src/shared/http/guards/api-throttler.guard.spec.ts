import type { ExecutionContext } from '@nestjs/common';
import type { ThrottlerLimitDetail } from '@nestjs/throttler';
import { faker } from '@test/support/faker.js';
import { RateLimitExceededException } from '../../domain/errors/rate-limit-exceeded.exception.js';
import { ApiThrottlerGuard } from './api-throttler.guard.js';

/**
 * A guarda só substitui a exceção da biblioteca e garante o `Retry-After`
 * padrão; a contagem é exercitada em `test/http/throttler.e2e-spec.ts`,
 * contra Redis real.
 */
class ExposedGuard extends ApiThrottlerGuard {
  reject(
    detail: ThrottlerLimitDetail,
    response: { header: (name: string, value: unknown) => void },
  ): Promise<void> {
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({}),
        getResponse: () => response,
      }),
    } as unknown as ExecutionContext;

    return this.throwThrottlingException(context, detail);
  }
}

describe('ApiThrottlerGuard', () => {
  const guard = Object.create(ExposedGuard.prototype) as ExposedGuard;
  const header = vi.fn();
  const response = { header };

  function detailOf(
    limit: number,
    timeToBlockExpire: number,
  ): ThrottlerLimitDetail {
    return {
      limit,
      timeToBlockExpire,
      ttl: 60_000,
      key: faker.string.alphanumeric(16),
      tracker: faker.internet.ipv4(),
      totalHits: limit + 1,
      timeToExpire: 60,
      isBlocked: true,
    };
  }

  it('lança a exceção de domínio, para o 429 sair no corpo padronizado', async () => {
    const limit = faker.number.int({ min: 1, max: 500 });
    const retryAfter = faker.number.int({ min: 1, max: 3_600 });

    const attempt = guard.reject(detailOf(limit, retryAfter), response);

    await expect(attempt).rejects.toBeInstanceOf(RateLimitExceededException);
    await expect(attempt).rejects.toMatchObject({
      code: 'RATE_LIMIT_EXCEEDED',
      details: { limit, retry_after_seconds: retryAfter },
    });
  });

  it('escreve o Retry-After padrão, sem o sufixo do nome do limite', async () => {
    const retryAfter = faker.number.int({ min: 1, max: 3_600 });

    await guard.reject(detailOf(10, retryAfter), response).catch(() => {});

    expect(header).toHaveBeenCalledWith('Retry-After', retryAfter);
  });

  it('não expõe a chave de rastreio do consumidor na resposta', async () => {
    const detail = detailOf(10, 30);

    await expect(guard.reject(detail, response)).rejects.not.toMatchObject({
      details: { tracker: detail.tracker },
    });
  });
});

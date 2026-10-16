import type { Redis } from 'ioredis';
import {
  RedisSourceRateLimiter,
  SOURCE_RATE_KEY_PREFIX,
} from './redis-source-rate-limiter.provider.js';

/**
 * A contagem em si é do script Lua e é exercitada contra Redis real em
 * `test/integration/source-rate-limiter.e2e-spec.ts`; aqui, os argumentos que
 * o limitador envia e como lê a resposta.
 */
describe('RedisSourceRateLimiter', () => {
  const evalScript = vi.fn();
  const limiter = new RedisSourceRateLimiter({
    eval: evalScript,
  } as unknown as Redis);

  beforeEach(() => {
    vi.useFakeTimers({ now: new Date('2026-10-16T12:00:00.000Z') });
  });

  afterEach(() => {
    vi.useRealTimers();
    evalScript.mockReset();
  });

  it('devolve true quando o script reservou a chamada', async () => {
    evalScript.mockResolvedValue(1);

    await expect(limiter.tryAcquire('BRASIL_API', 90)).resolves.toBe(true);
  });

  it('devolve false quando o teto da janela já foi atingido', async () => {
    evalScript.mockResolvedValue(0);

    await expect(limiter.tryAcquire('BRASIL_API', 90)).resolves.toBe(false);
  });

  it('conta por fonte, na janela de um minuto, com o teto e o instante atuais', async () => {
    evalScript.mockResolvedValue(1);

    await limiter.tryAcquire('CGU_CEIS', 90);

    expect(evalScript).toHaveBeenCalledWith(
      expect.stringContaining('ZREMRANGEBYSCORE'),
      1,
      `${SOURCE_RATE_KEY_PREFIX}:CGU_CEIS`,
      Date.parse('2026-10-16T12:00:00.000Z'),
      60_000,
      90,
      expect.stringMatching(/^[0-9a-f-]{36}$/),
    );
  });

  it('dá a cada chamada um membro próprio, para duas no mesmo instante não se fundirem', async () => {
    evalScript.mockResolvedValue(1);

    await limiter.tryAcquire('BRASIL_API', 90);
    await limiter.tryAcquire('BRASIL_API', 90);

    const members = evalScript.mock.calls.map((call) => call[6] as string);
    expect(new Set(members).size).toBe(2);
  });

  it('propaga a falha do Redis, para quem chama não consultar a fonte', async () => {
    evalScript.mockRejectedValue(new Error('redis fora'));

    await expect(limiter.tryAcquire('BRASIL_API', 90)).rejects.toThrow(
      'redis fora',
    );
  });
});

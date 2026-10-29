import type { ConfigService } from '@nestjs/config';
import type { Environment } from '@shared/config/environment.config.js';
import { DecoyCompanyGenerator } from '../../domain/decoy-company.generator.js';
import { DecoyUnavailableException } from '../../domain/dtos/errors/decoy-unavailable.exception.js';
import { DecoyAvailability } from '../providers/decoy-availability.js';
import {
  GetDecoyCompanyUseCase,
  ListDecoyCompaniesUseCase,
} from './decoy-companies.usecases.js';

function availability(
  failureRate: number,
  maxDelayMs: number,
  random: () => number,
): DecoyAvailability {
  const values: Record<string, number> = {
    HONEYPOT_FAILURE_RATE: failureRate,
    HONEYPOT_MAX_DELAY_MS: maxDelayMs,
  };
  const config = {
    get: (key: string) => values[key],
  } as unknown as ConfigService<Environment, true>;

  return new DecoyAvailability(config, random);
}

describe('baixa disponibilidade proposital das iscas (#88)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('abaixo da fração configurada, responde 503', async () => {
    await expect(
      availability(0.25, 0, () => 0.2).simulate(),
    ).rejects.toBeInstanceOf(DecoyUnavailableException);
  });

  it('na fração ou acima, responde', async () => {
    await expect(
      availability(0.25, 0, () => 0.25).simulate(),
    ).resolves.toBeUndefined();
  });

  it('fração 0 nunca falha; fração 1 sempre falha', async () => {
    await expect(
      availability(0, 0, () => 0).simulate(),
    ).resolves.toBeUndefined();
    await expect(
      availability(1, 0, () => 0.999).simulate(),
    ).rejects.toBeInstanceOf(DecoyUnavailableException);
  });

  it('demora uma parte sorteada do atraso máximo', async () => {
    vi.useFakeTimers();
    const random = vi.fn().mockReturnValueOnce(0.9).mockReturnValueOnce(0.5);
    let done = false;

    const pending = availability(0.25, 2_000, random)
      .simulate()
      .then(() => {
        done = true;
      });
    await vi.advanceTimersByTimeAsync(999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await pending;

    expect(done).toBe(true);
  });

  it('a falha simulada imita a indisponibilidade real (503, mesmo código)', () => {
    const error = new DecoyUnavailableException();

    expect(error.getStatus()).toBe(503);
    expect(error.code).toBe('COMPANY_DATA_UNAVAILABLE');
  });

  it('os casos de uso simulam a disponibilidade antes de gerar', async () => {
    const generator = new DecoyCompanyGenerator();
    const failing = availability(1, 0, () => 0);

    await expect(
      new ListDecoyCompaniesUseCase(generator, failing).execute({
        page: 1,
        page_size: 10,
      }),
    ).rejects.toBeInstanceOf(DecoyUnavailableException);
    await expect(
      new GetDecoyCompanyUseCase(generator, failing).execute('11222333000181'),
    ).rejects.toBeInstanceOf(DecoyUnavailableException);

    const working = availability(0, 0, () => 0.5);
    const page = await new ListDecoyCompaniesUseCase(
      generator,
      working,
    ).execute({ page: 2, page_size: 5 });

    expect(page.data).toHaveLength(5);
    expect(page.pagination).toMatchObject({ page: 2, page_size: 5 });
    await expect(
      new GetDecoyCompanyUseCase(generator, working).execute('11222333000181'),
    ).resolves.toMatchObject({ cnpj: '11222333000181' });
  });
});

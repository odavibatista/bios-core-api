import { Controller, Get, type INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { SkipThrottle } from '@nestjs/throttler';
import { validateEnvironment } from '@shared/config/environment.config.js';
import {
  API_KEY_HEADER,
  THROTTLER_KEY_PREFIX,
} from '@shared/config/throttler.config.js';
import { ErrorResponseSchema } from '@shared/domain/dtos/errors/error-response.dto.js';
import { AllExceptionsFilter } from '@shared/infra/filters/all-exceptions.filter.js';
import { ThrottlerModule } from '@shared/infra/modules/throttler.module.js';
import { HealthController } from '@shared/http/controllers/health.controller.js';
import { PublicApiRoute } from '@shared/http/decorators/public-api-route.decorator.js';
import { SkipRateLimit } from '@shared/http/decorators/skip-rate-limit.decorator.js';
import { CheckHealthUseCase } from '@shared/infra/usecases/health/check-health.usecase.js';
import { Redis } from 'ioredis';
import request from 'supertest';
import { inject } from 'vitest';
import { healthCheckResponseFactory } from '../factories/shared/health-check-response.factory.js';
import { faker } from '../support/faker.js';
import { buildTestEnvironment } from '../support/environment.js';

/** Limite curto: o estouro tem de acontecer em poucas requisições. */
const LIMIT = 2;

/** Endpoints de prova, nos três regimes possíveis de limite. */
@Controller('prova')
class ProbeController {
  /** Sujeito aos dois limites: o geral (por IP) e o da API pública. */
  @Get('limitado')
  limited(): { ok: true } {
    return { ok: true };
  }

  /** Só o limite da API pública, contado por chave de API. */
  @Get('publico')
  @PublicApiRoute()
  @SkipThrottle({ default: true })
  publicApi(): { ok: true } {
    return { ok: true };
  }

  /**
   * Sem a marca de API pública: o limite por chave não incide, mesmo que a
   * requisição traga uma chave. Só o geral (aqui dispensado) a alcançaria.
   */
  @Get('interno')
  @SkipThrottle({ default: true })
  internal(): { ok: true } {
    return { ok: true };
  }

  /** Fora de qualquer limite. */
  @Get('isento')
  @SkipRateLimit()
  exempt(): { ok: true } {
    return { ok: true };
  }

  /**
   * Isento apenas pelo `@SkipThrottle()` da biblioteca, que ignora só o limite
   * `default`: serve para provar por que o decorator do projeto existe.
   */
  @Get('meio-isento')
  @PublicApiRoute()
  @SkipThrottle()
  partiallyExempt(): { ok: true } {
    return { ok: true };
  }
}

describe.runIf(inject('redisAvailable'))('Limite de requisições (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [
            () =>
              validateEnvironment(
                buildTestEnvironment({
                  REDIS_URL: inject('testRedisUrl'),
                  THROTTLE_LIMIT: String(LIMIT),
                  THROTTLE_PUBLIC_API_LIMIT: String(LIMIT),
                }),
              ),
          ],
        }),
        ThrottlerModule,
      ],
      controllers: [ProbeController, HealthController],
      providers: [
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
        {
          provide: CheckHealthUseCase,
          useValue: {
            execute: () => Promise.resolve(healthCheckResponseFactory.build()),
          },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  function get(path: string, apiKey?: string) {
    const pending = request(app.getHttpServer()).get(path);

    return apiKey ? pending.set(API_KEY_HEADER, apiKey) : pending;
  }

  it('deixa passar as requisições dentro do limite, informando a cota', async () => {
    const response = await get('/prova/limitado').expect(200);

    expect(response.headers['x-ratelimit-limit']).toBe(String(LIMIT));
    expect(response.headers['x-ratelimit-remaining']).toBeDefined();
  });

  it('responde 429 no formato padrão de erro, com Retry-After', async () => {
    for (let attempt = 0; attempt < LIMIT; attempt += 1) {
      await get('/prova/limitado');
    }

    const response = await get('/prova/limitado').expect(429);

    expect(Number(response.headers['retry-after'])).toBeGreaterThan(0);
    expect(ErrorResponseSchema.parse(response.body)).toMatchObject({
      statusCode: 429,
      code: 'RATE_LIMIT_EXCEEDED',
      path: '/prova/limitado',
    });
  });

  it('dá cota própria a cada chave de API', async () => {
    const [first, second] = faker.helpers.uniqueArray(
      () => faker.string.alphanumeric(32),
      2,
    );

    for (let attempt = 0; attempt < LIMIT; attempt += 1) {
      await get('/prova/publico', first).expect(200);
    }
    await get('/prova/publico', first).expect(429);

    // A cota é do integrador, não do endereço: a outra chave segue livre.
    await get('/prova/publico', second).expect(200);
  });

  it('o limite por chave só vale nas rotas da API pública', async () => {
    const key = faker.string.alphanumeric(32);

    for (let attempt = 0; attempt < LIMIT * 3; attempt += 1) {
      await get('/prova/interno', key).expect(200);
    }
  });

  it('não grava a chave de API em claro no Redis: o contador usa um resumo', async () => {
    const key = faker.string.alphanumeric(40);
    await get('/prova/publico', key).expect(200);

    const redis = new Redis(inject('testRedisUrl'));
    try {
      const names = await redis.keys(`${THROTTLER_KEY_PREFIX}*`);

      expect(names.length).toBeGreaterThan(0);
      expect(names.some((name) => name.includes(key))).toBe(false);
    } finally {
      redis.disconnect();
    }
  });

  it('não limita endpoint isento', async () => {
    for (let attempt = 0; attempt < LIMIT * 3; attempt += 1) {
      await get('/prova/isento').expect(200);
    }
  });

  it('o SkipThrottle da biblioteca não isenta dos limites nomeados', async () => {
    for (let attempt = 0; attempt < LIMIT; attempt += 1) {
      await get('/prova/meio-isento').expect(200);
    }

    // É por isso que o projeto tem o próprio decorator de isenção.
    await get('/prova/meio-isento').expect(429);
  });

  it('não limita o health check, sondado de forma periódica', async () => {
    for (let attempt = 0; attempt < LIMIT * 3; attempt += 1) {
      await get('/health').expect(200);
    }
  });
});

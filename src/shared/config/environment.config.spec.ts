import {
  buildKey,
  buildKeyring,
} from '@test/factories/shared/encryption-key.factory.js';
import { faker } from '@test/support/faker.js';
import { EnvironmentException } from '../domain/errors/environment.exception.js';
import {
  RuntimeEnvironment,
  validateEnvironment,
} from './environment.config.js';

/** Nome de banco MongoDB aleatório. */
function databaseName(): string {
  return faker.string.alpha({ length: { min: 3, max: 12 }, casing: 'lower' });
}

const DATABASE_URL = `mongodb://${faker.internet.domainName()}:${faker.internet.port()}/${databaseName()}?directConnection=true`;

const REDIS_URL = `redis://${faker.internet.domainName()}:${faker.internet.port()}/1`;

/** Variáveis sem valor padrão: a aplicação não sobe sem elas. */
const REQUIRED = {
  DATABASE_URL,
  REDIS_URL,
  ENCRYPTION_KEYS: buildKeyring(),
  BLIND_INDEX_KEY: buildKey(),
  AUTH_ACCESS_TOKEN_SECRET: buildKey(),
  SMTP_HOST: faker.internet.domainName(),
  SMTP_PORT: String(faker.internet.port()),
  SMTP_USER: faker.internet.username(),
  SMTP_PASSWORD: faker.internet.password(),
  MAIL_FROM: `BIOS <${faker.internet.email()}>`,
  FRONTEND_URL: faker.internet.url(),
};

describe('validateEnvironment', () => {
  it('aplica os valores padrão quando só as variáveis obrigatórias são informadas', () => {
    const environment = validateEnvironment({ ...REQUIRED });

    expect(environment).toMatchObject({
      NODE_ENV: 'development',
      PORT: 3000,
      DATABASE_URL,
      CORS_ORIGINS: true,
      BCRYPT_COST: 12,
      QUEUE_WAIT_TIMEOUT_MS: 10_000,
      QUEUE_SCHEDULES_SYNC_ON_BOOT: true,
      THROTTLE_LIMIT: 120,
      THROTTLE_PUBLIC_API_LIMIT: 60,
      DATA_RETENTION_SYNC_ON_BOOT: true,
    });
    expect(environment.CACHE_DEFAULT_TTL.toString()).toBe('1w');
    expect(environment.DATA_RETENTION_USER_TOKENS.toString()).toBe('1w');
    expect(environment.DATA_RETENTION_LOGIN_ATTEMPTS.toString()).toBe('90d');
    expect(environment.AUTH_ACCESS_TOKEN_LIFETIME.toString()).toBe('15m');
    expect(environment.AUTH_REFRESH_TOKEN_LIFETIME.toString()).toBe('1w');
    expect(environment.AUTH_EMAIL_CONFIRMATION_TOKEN_LIFETIME.toString()).toBe(
      '1d',
    );
    expect(environment.AUTH_PASSWORD_RESET_TOKEN_LIFETIME.toString()).toBe(
      '2h',
    );
  });

  describe('links enviados por e-mail', () => {
    it('aceita durações dentro dos limites', () => {
      const confirmationHours = faker.number.int({ min: 1, max: 24 * 7 });
      const resetMinutes = faker.number.int({ min: 5, max: 24 * 60 });

      const environment = validateEnvironment({
        ...REQUIRED,
        AUTH_EMAIL_CONFIRMATION_TOKEN_LIFETIME: `${confirmationHours}h`,
        AUTH_PASSWORD_RESET_TOKEN_LIFETIME: `${resetMinutes}m`,
      });

      expect(
        environment.AUTH_EMAIL_CONFIRMATION_TOKEN_LIFETIME.toSeconds(),
      ).toBe(confirmationHours * 3_600);
      expect(environment.AUTH_PASSWORD_RESET_TOKEN_LIFETIME.toSeconds()).toBe(
        resetMinutes * 60,
      );
    });

    it('limita a confirmação a no máximo 7 dias', () => {
      const days = faker.number.int({ min: 8, max: 365 });

      expect(() =>
        validateEnvironment({
          ...REQUIRED,
          AUTH_EMAIL_CONFIRMATION_TOKEN_LIFETIME: `${days}d`,
        }),
      ).toThrow(
        /AUTH_EMAIL_CONFIRMATION_TOKEN_LIFETIME: deve ser uma duração entre 1h e 1w/,
      );
    });

    it('exige confirmação de no mínimo 1 hora', () => {
      const minutes = faker.number.int({ min: 1, max: 59 });

      expect(() =>
        validateEnvironment({
          ...REQUIRED,
          AUTH_EMAIL_CONFIRMATION_TOKEN_LIFETIME: `${minutes}m`,
        }),
      ).toThrow(/AUTH_EMAIL_CONFIRMATION_TOKEN_LIFETIME: deve ser uma duração/);
    });

    it('limita a redefinição de senha a no máximo 24 horas', () => {
      const hours = faker.number.int({ min: 25, max: 1_000 });

      expect(() =>
        validateEnvironment({
          ...REQUIRED,
          AUTH_PASSWORD_RESET_TOKEN_LIFETIME: `${hours}h`,
        }),
      ).toThrow(
        /AUTH_PASSWORD_RESET_TOKEN_LIFETIME: deve ser uma duração entre 5m e 1d/,
      );
    });

    it('exige redefinição de senha de no mínimo 5 minutos', () => {
      const minutes = faker.number.int({ min: 1, max: 4 });

      expect(() =>
        validateEnvironment({
          ...REQUIRED,
          AUTH_PASSWORD_RESET_TOKEN_LIFETIME: `${minutes}m`,
        }),
      ).toThrow(/AUTH_PASSWORD_RESET_TOKEN_LIFETIME: deve ser uma duração/);
    });
  });

  describe('sessões', () => {
    it('aceita durações dentro dos limites', () => {
      const accessMinutes = faker.number.int({ min: 1, max: 60 });
      const refreshHours = faker.number.int({ min: 1, max: 24 * 90 });

      const environment = validateEnvironment({
        ...REQUIRED,
        AUTH_ACCESS_TOKEN_LIFETIME: `${accessMinutes}m`,
        AUTH_REFRESH_TOKEN_LIFETIME: `${refreshHours}h`,
      });

      expect(environment.AUTH_ACCESS_TOKEN_LIFETIME.toSeconds()).toBe(
        accessMinutes * 60,
      );
      expect(environment.AUTH_REFRESH_TOKEN_LIFETIME.toSeconds()).toBe(
        refreshHours * 3_600,
      );
    });

    it('limita o access token a no máximo 1 hora', () => {
      const minutes = faker.number.int({ min: 61, max: 10_000 });

      expect(() =>
        validateEnvironment({
          ...REQUIRED,
          AUTH_ACCESS_TOKEN_LIFETIME: `${minutes}m`,
        }),
      ).toThrow(
        /AUTH_ACCESS_TOKEN_LIFETIME: deve ser uma duração entre 1m e 1h/,
      );
    });

    it('exige refresh token de no mínimo 1 hora', () => {
      const minutes = faker.number.int({ min: 1, max: 59 });

      expect(() =>
        validateEnvironment({
          ...REQUIRED,
          AUTH_REFRESH_TOKEN_LIFETIME: `${minutes}m`,
        }),
      ).toThrow(
        /AUTH_REFRESH_TOKEN_LIFETIME: deve ser uma duração de no mínimo 1h/,
      );
    });
  });

  describe('limite de requisições', () => {
    it('converte janelas e tetos dos dois limites', () => {
      const environment = validateEnvironment({
        ...REQUIRED,
        THROTTLE_TTL: '30s',
        THROTTLE_LIMIT: '200',
        THROTTLE_PUBLIC_API_TTL: '5m',
        THROTTLE_PUBLIC_API_LIMIT: '30',
      });

      expect(environment.THROTTLE_TTL.toSeconds()).toBe(30);
      expect(environment.THROTTLE_LIMIT).toBe(200);
      expect(environment.THROTTLE_PUBLIC_API_TTL.toSeconds()).toBe(300);
      expect(environment.THROTTLE_PUBLIC_API_LIMIT).toBe(30);
    });

    it.each(['THROTTLE_TTL', 'THROTTLE_PUBLIC_API_TTL'])(
      'rejeita janela de %s acima de 1h',
      (variable) => {
        expect(() =>
          validateEnvironment({ ...REQUIRED, [variable]: '2h' }),
        ).toThrow(new RegExp(variable));
      },
    );

    it.each(['THROTTLE_LIMIT', 'THROTTLE_PUBLIC_API_LIMIT'])(
      'rejeita teto de %s abaixo de uma requisição',
      (variable) => {
        expect(() =>
          validateEnvironment({ ...REQUIRED, [variable]: '0' }),
        ).toThrow(new RegExp(variable));
      },
    );
  });

  describe('filas', () => {
    it('aceita um prazo de espera dentro dos limites', () => {
      const timeout = faker.number.int({ min: 1_000, max: 60_000 });

      const environment = validateEnvironment({
        ...REQUIRED,
        QUEUE_WAIT_TIMEOUT_MS: String(timeout),
        QUEUE_SCHEDULES_SYNC_ON_BOOT: 'false',
      });

      expect(environment.QUEUE_WAIT_TIMEOUT_MS).toBe(timeout);
      expect(environment.QUEUE_SCHEDULES_SYNC_ON_BOOT).toBe(false);
    });

    it.each([
      ['curto demais para uma fonte externa', 999],
      ['longo demais para uma requisição HTTP', 60_001],
    ])('rejeita o prazo de espera %s', (_case, value) => {
      expect(() =>
        validateEnvironment({
          ...REQUIRED,
          QUEUE_WAIT_TIMEOUT_MS: String(value),
        }),
      ).toThrow(/QUEUE_WAIT_TIMEOUT_MS/);
    });

    it.each(['amqp://localhost', 'localhost:6379', faker.lorem.word()])(
      'rejeita a URL de Redis "%s"',
      (url) => {
        const attempt = () =>
          validateEnvironment({ ...REQUIRED, REDIS_URL: url });

        expect(attempt).toThrow(EnvironmentException);
        expect(attempt).toThrow(/REDIS_URL: deve ser uma URL Redis/);
      },
    );

    it('converte a janela de reserva do cache', () => {
      const days = faker.number.int({ min: 1, max: 30 });

      expect(
        validateEnvironment({
          ...REQUIRED,
          CACHE_DEFAULT_TTL: `${days}d`,
        }).CACHE_DEFAULT_TTL.toSeconds(),
      ).toBe(days * 86_400);
    });

    it('rejeita janela de reserva do cache sem unidade', () => {
      expect(() =>
        validateEnvironment({ ...REQUIRED, CACHE_DEFAULT_TTL: '604800' }),
      ).toThrow(/CACHE_DEFAULT_TTL/);
    });

    it('aceita Redis com TLS', () => {
      const url = `rediss://${faker.internet.domainName()}:6380`;

      expect(
        validateEnvironment({ ...REQUIRED, REDIS_URL: url }).REDIS_URL,
      ).toBe(url);
    });
  });

  describe('retenção de dados', () => {
    it('converte as durações configuradas', () => {
      const hours = faker.number.int({ min: 1, max: 24 * 365 });

      const environment = validateEnvironment({
        ...REQUIRED,
        DATA_RETENTION_USER_SESSIONS: `${hours}h`,
        DATA_RETENTION_SYNC_ON_BOOT: 'false',
      });

      expect(environment.DATA_RETENTION_USER_SESSIONS.toSeconds()).toBe(
        hours * 3_600,
      );
      expect(environment.DATA_RETENTION_SYNC_ON_BOOT).toBe(false);
    });

    it.each([
      ['sem unidade', String(faker.number.int({ min: 1, max: 999 }))],
      ['abaixo de 1m', `${faker.number.int({ min: 1, max: 59 })}s`],
      ['malformada', faker.lorem.words(2)],
    ])('rejeita a duração %s ("%s")', (_case, value) => {
      expect(() =>
        validateEnvironment({
          ...REQUIRED,
          DATA_RETENTION_HONEYPOT_HITS: value,
        }),
      ).toThrow(
        /DATA_RETENTION_HONEYPOT_HITS: deve ser uma duração de no mínimo 1m/,
      );
    });
  });

  it('converte PORT para número e CORS_ORIGINS em lista de origens', () => {
    const nodeEnv = faker.helpers.objectValue(RuntimeEnvironment);
    const port = faker.number.int({ min: 1, max: 65_535 });
    const origins = faker.helpers.uniqueArray(
      () => faker.internet.url({ appendSlash: false }),
      faker.number.int({ min: 1, max: 4 }),
    );

    const environment = validateEnvironment({
      ...REQUIRED,
      NODE_ENV: nodeEnv,
      PORT: String(port),
      // Espaços e a vírgula final são descartados.
      CORS_ORIGINS: `${origins.join(', ')},`,
    });

    expect(environment.NODE_ENV).toBe(nodeEnv);
    expect(environment.PORT).toBe(port);
    expect(environment.CORS_ORIGINS).toEqual(origins);
  });

  describe('criptografia', () => {
    it('converte as chaves em material pronto para uso', () => {
      const environment = validateEnvironment({
        ...REQUIRED,
        ENCRYPTION_KEYS: buildKeyring([1, 2]),
      });

      expect(environment.ENCRYPTION_KEYS.activeVersion).toBe(2);
      expect([...environment.ENCRYPTION_KEYS.keys.keys()]).toEqual([1, 2]);
      expect(environment.BLIND_INDEX_KEY).toHaveLength(32);
      expect(environment.AUTH_ACCESS_TOKEN_SECRET).toHaveLength(32);
    });

    it.each([
      ['ENCRYPTION_KEYS', 'sem versão'],
      ['BLIND_INDEX_KEY', 'de tamanho inválido'],
      ['AUTH_ACCESS_TOKEN_SECRET', 'de tamanho inválido'],
    ])('rejeita %s %s', (variable) => {
      const attempt = () =>
        validateEnvironment({ ...REQUIRED, [variable]: 'chave-invalida' });

      expect(attempt).toThrow(EnvironmentException);
      expect(attempt).toThrow(new RegExp(variable));
    });

    it('aceita um custo de bcrypt dentro dos limites do algoritmo', () => {
      const cost = faker.number.int({ min: 4, max: 31 });

      expect(
        validateEnvironment({ ...REQUIRED, BCRYPT_COST: String(cost) })
          .BCRYPT_COST,
      ).toBe(cost);
    });

    it.each([
      [
        'abaixo do mínimo do bcrypt',
        String(faker.number.int({ min: 0, max: 3 })),
      ],
      [
        'acima do máximo do bcrypt',
        String(faker.number.int({ min: 32, max: 99 })),
      ],
      ['fracionário', '12.5'],
    ])('rejeita o custo de bcrypt %s', (_case, value) => {
      expect(() =>
        validateEnvironment({ ...REQUIRED, BCRYPT_COST: value }),
      ).toThrow(/BCRYPT_COST/);
    });
  });

  it('aceita connection strings mongodb+srv', () => {
    const url = `mongodb+srv://${faker.internet.username()}:${faker.internet.password()}@${faker.internet.domainName()}/${databaseName()}`;

    expect(
      validateEnvironment({ ...REQUIRED, DATABASE_URL: url }).DATABASE_URL,
    ).toBe(url);
  });

  it('lança EnvironmentException listando todas as variáveis inválidas', () => {
    const attempt = () =>
      validateEnvironment({
        ...REQUIRED,
        DATABASE_URL: `postgres://${faker.internet.domainName()}/${databaseName()}`,
        NODE_ENV: faker.lorem.word(),
      });

    expect(attempt).toThrow(EnvironmentException);
    expect(attempt).toThrow(
      /DATABASE_URL: deve ser uma connection string MongoDB/,
    );
    expect(attempt).toThrow(/NODE_ENV/);
  });

  it.each(Object.keys(REQUIRED))('exige %s', (variable) => {
    const incomplete = Object.fromEntries(
      Object.entries(REQUIRED).filter(([name]) => name !== variable),
    );

    expect(() => validateEnvironment(incomplete)).toThrow(new RegExp(variable));
  });
});

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

/** Variáveis sem valor padrão: a aplicação não sobe sem elas. */
const REQUIRED = {
  DATABASE_URL,
  ENCRYPTION_KEYS: buildKeyring(),
  BLIND_INDEX_KEY: buildKey(),
};

describe('validateEnvironment', () => {
  it('aplica os valores padrão quando só as variáveis obrigatórias são informadas', () => {
    const environment = validateEnvironment({ ...REQUIRED });

    expect(environment).toMatchObject({
      NODE_ENV: 'development',
      PORT: 3000,
      DATABASE_URL,
      CORS_ORIGINS: true,
      DATA_RETENTION_SYNC_ON_BOOT: true,
    });
    expect(environment.DATA_RETENTION_USER_TOKENS.toString()).toBe('1w');
    expect(environment.DATA_RETENTION_LOGIN_ATTEMPTS.toString()).toBe('90d');
    expect(environment.AUTH_ACCESS_TOKEN_LIFETIME.toString()).toBe('15m');
    expect(environment.AUTH_REFRESH_TOKEN_LIFETIME.toString()).toBe('1w');
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
    });

    it.each([
      ['ENCRYPTION_KEYS', 'sem versão'],
      ['BLIND_INDEX_KEY', 'de tamanho inválido'],
    ])('rejeita %s %s', (variable) => {
      const attempt = () =>
        validateEnvironment({ ...REQUIRED, [variable]: 'chave-invalida' });

      expect(attempt).toThrow(EnvironmentException);
      expect(attempt).toThrow(new RegExp(variable));
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

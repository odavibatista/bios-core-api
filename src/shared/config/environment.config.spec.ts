import { EnvironmentException } from '../domain/errors/environment.exception.js';
import { validateEnvironment } from './environment.config.js';

const DATABASE_URL = 'mongodb://localhost:27017/bios?directConnection=true';

describe('validateEnvironment', () => {
  it('aplica os valores padrão quando apenas DATABASE_URL é informada', () => {
    const environment = validateEnvironment({ DATABASE_URL });

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
      const environment = validateEnvironment({
        DATABASE_URL,
        AUTH_ACCESS_TOKEN_LIFETIME: '60m',
        AUTH_REFRESH_TOKEN_LIFETIME: '1h',
      });

      expect(environment.AUTH_ACCESS_TOKEN_LIFETIME.toSeconds()).toBe(3_600);
      expect(environment.AUTH_REFRESH_TOKEN_LIFETIME.toSeconds()).toBe(3_600);
    });

    it('limita o access token a no máximo 1 hora', () => {
      expect(() =>
        validateEnvironment({ DATABASE_URL, AUTH_ACCESS_TOKEN_LIFETIME: '2h' }),
      ).toThrow(
        /AUTH_ACCESS_TOKEN_LIFETIME: deve ser uma duração entre 1m e 1h/,
      );
    });

    it('exige refresh token de no mínimo 1 hora', () => {
      expect(() =>
        validateEnvironment({
          DATABASE_URL,
          AUTH_REFRESH_TOKEN_LIFETIME: '30m',
        }),
      ).toThrow(
        /AUTH_REFRESH_TOKEN_LIFETIME: deve ser uma duração de no mínimo 1h/,
      );
    });
  });

  describe('retenção de dados', () => {
    it('converte as durações configuradas', () => {
      const environment = validateEnvironment({
        DATABASE_URL,
        DATA_RETENTION_USER_SESSIONS: '12h',
        DATA_RETENTION_SYNC_ON_BOOT: 'false',
      });

      expect(environment.DATA_RETENTION_USER_SESSIONS.toSeconds()).toBe(43_200);
      expect(environment.DATA_RETENTION_SYNC_ON_BOOT).toBe(false);
    });

    it.each(['90', '30s', 'sete dias'])(
      'rejeita a duração "%s" (sem unidade, abaixo de 1m ou malformada)',
      (value) => {
        expect(() =>
          validateEnvironment({
            DATABASE_URL,
            DATA_RETENTION_HONEYPOT_HITS: value,
          }),
        ).toThrow(
          /DATA_RETENTION_HONEYPOT_HITS: deve ser uma duração de no mínimo 1m/,
        );
      },
    );
  });

  it('converte PORT para número e CORS_ORIGINS em lista de origens', () => {
    const environment = validateEnvironment({
      DATABASE_URL,
      NODE_ENV: 'production',
      PORT: '8080',
      CORS_ORIGINS: 'https://bios.app, https://admin.bios.app,',
    });

    expect(environment.PORT).toBe(8080);
    expect(environment.CORS_ORIGINS).toEqual([
      'https://bios.app',
      'https://admin.bios.app',
    ]);
  });

  it('aceita connection strings mongodb+srv', () => {
    const url = 'mongodb+srv://user:pass@cluster.example.net/bios';

    expect(validateEnvironment({ DATABASE_URL: url }).DATABASE_URL).toBe(url);
  });

  it('lança EnvironmentException listando todas as variáveis inválidas', () => {
    const attempt = () =>
      validateEnvironment({
        DATABASE_URL: 'postgres://localhost/bios',
        NODE_ENV: 'staging',
      });

    expect(attempt).toThrow(EnvironmentException);
    expect(attempt).toThrow(
      /DATABASE_URL: deve ser uma connection string MongoDB/,
    );
    expect(attempt).toThrow(/NODE_ENV/);
  });

  it('exige DATABASE_URL', () => {
    expect(() => validateEnvironment({})).toThrow(/DATABASE_URL/);
  });
});

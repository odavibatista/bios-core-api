import type { ConfigService } from '@nestjs/config';
import { UserRole } from '@prisma/client';
import type { Environment } from '@shared/config/environment.config.js';
import { Duration } from '@shared/domain/value-objects/duration.js';
import { buildKey } from '@test/factories/shared/encryption-key.factory.js';
import { decodeKey } from '@shared/config/encryption.config.js';
import { faker } from '@test/support/faker.js';
import jsonwebtoken from 'jsonwebtoken';
import {
  ACCESS_TOKEN_ISSUER,
  JwtAccessTokenProvider,
} from './jwt-access-token.provider.js';

const LIFETIME_MINUTES = 15;

function newSecret(): Buffer {
  return decodeKey(buildKey())!;
}

function createProvider(secret = newSecret()): JwtAccessTokenProvider {
  const values: Partial<Environment> = {
    AUTH_ACCESS_TOKEN_SECRET: secret,
    AUTH_ACCESS_TOKEN_LIFETIME: Duration.parse(`${LIFETIME_MINUTES}m`),
  };

  return new JwtAccessTokenProvider({
    get: (key: keyof Environment) => values[key],
  } as unknown as ConfigService<Environment, true>);
}

function buildClaims() {
  return {
    userId: faker.database.mongodbObjectId(),
    sessionId: faker.database.mongodbObjectId(),
    role: faker.helpers.objectValue(UserRole),
  };
}

describe('JwtAccessTokenProvider', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  describe('sign e verify', () => {
    it('devolve as afirmações assinadas', () => {
      const provider = createProvider();
      const claims = buildClaims();

      const { token } = provider.sign(claims);

      expect(provider.verify(token)).toEqual(claims);
    });

    it('informa a vida do token em segundos', () => {
      const { expiresInSeconds } = createProvider().sign(buildClaims());

      expect(expiresInSeconds).toBe(LIFETIME_MINUTES * 60);
    });

    it('grava usuário, sessão, papel, emissor e expiração no token', () => {
      vi.useFakeTimers({ now: faker.date.recent() });
      const claims = buildClaims();

      const { token } = createProvider().sign(claims);

      const payload = jsonwebtoken.decode(token, { json: true })!;
      expect(payload).toMatchObject({
        sub: claims.userId,
        sid: claims.sessionId,
        role: claims.role,
        iss: ACCESS_TOKEN_ISSUER,
      });
      expect(payload.exp! - payload.iat!).toBe(LIFETIME_MINUTES * 60);
    });

    it('assina com HS256', () => {
      const { token } = createProvider().sign(buildClaims());

      expect(jsonwebtoken.decode(token, { complete: true })!.header.alg).toBe(
        'HS256',
      );
    });

    it('não grava dado pessoal no token', () => {
      const { token } = createProvider().sign(buildClaims());

      expect(
        Object.keys(jsonwebtoken.decode(token, { json: true })!).sort(),
      ).toEqual(['exp', 'iat', 'iss', 'role', 'sid', 'sub']);
    });
  });

  describe('verificação recusa', () => {
    it('o token assinado com outro segredo', () => {
      const { token } = createProvider(newSecret()).sign(buildClaims());

      expect(createProvider(newSecret()).verify(token)).toBeNull();
    });

    it('o token cujo corpo foi adulterado', () => {
      const provider = createProvider();
      const [header, , signature] = provider
        .sign(buildClaims())
        .token.split('.');
      const forgedBody = Buffer.from(
        JSON.stringify({
          sub: faker.database.mongodbObjectId(),
          sid: faker.database.mongodbObjectId(),
          role: UserRole.ADMIN,
          iss: ACCESS_TOKEN_ISSUER,
          exp: Math.floor(Date.now() / 1_000) + 3_600,
        }),
      ).toString('base64url');

      expect(
        provider.verify(`${header}.${forgedBody}.${signature}`),
      ).toBeNull();
    });

    it('o token expirado', () => {
      vi.useFakeTimers({ now: faker.date.recent() });
      const provider = createProvider();
      const { token } = provider.sign(buildClaims());

      vi.advanceTimersByTime((LIFETIME_MINUTES * 60 + 1) * 1_000);

      expect(provider.verify(token)).toBeNull();
    });

    it('o token no limite da validade ainda aceito', () => {
      vi.useFakeTimers({ now: faker.date.recent() });
      const provider = createProvider();
      const { token } = provider.sign(buildClaims());

      vi.advanceTimersByTime((LIFETIME_MINUTES * 60 - 1) * 1_000);

      expect(provider.verify(token)).not.toBeNull();
    });

    it('o token sem assinatura (alg none)', () => {
      const claims = buildClaims();
      const encode = (value: object) =>
        Buffer.from(JSON.stringify(value)).toString('base64url');
      const unsigned = `${encode({ alg: 'none', typ: 'JWT' })}.${encode({
        sub: claims.userId,
        sid: claims.sessionId,
        role: claims.role,
        iss: ACCESS_TOKEN_ISSUER,
      })}.`;

      expect(createProvider().verify(unsigned)).toBeNull();
    });

    it('o token assinado com outro algoritmo, mesmo com o segredo certo', () => {
      const secret = newSecret();
      const claims = buildClaims();
      const token = jsonwebtoken.sign(
        { sid: claims.sessionId, role: claims.role },
        secret,
        {
          algorithm: 'HS512',
          issuer: ACCESS_TOKEN_ISSUER,
          subject: claims.userId,
          expiresIn: 60,
        },
      );

      expect(createProvider(secret).verify(token)).toBeNull();
    });

    it('o token de outro emissor', () => {
      const secret = newSecret();
      const claims = buildClaims();
      const token = jsonwebtoken.sign(
        { sid: claims.sessionId, role: claims.role },
        secret,
        {
          algorithm: 'HS256',
          issuer: faker.company.name(),
          subject: claims.userId,
          expiresIn: 60,
        },
      );

      expect(createProvider(secret).verify(token)).toBeNull();
    });

    it.each([
      ['sem sessão (sid)', { role: UserRole.USER }],
      ['sem papel', { sid: 'abc' }],
      ['com papel desconhecido', { sid: 'abc', role: 'ROOT' }],
      ['com sessão que não é texto', { sid: 123, role: UserRole.USER }],
    ])('o token %s', (_case, extra) => {
      const secret = newSecret();
      const token = jsonwebtoken.sign(extra, secret, {
        algorithm: 'HS256',
        issuer: ACCESS_TOKEN_ISSUER,
        subject: faker.database.mongodbObjectId(),
        expiresIn: 60,
      });

      expect(createProvider(secret).verify(token)).toBeNull();
    });

    it('o token sem usuário (sub)', () => {
      const secret = newSecret();
      const token = jsonwebtoken.sign(
        { sid: 'abc', role: UserRole.USER },
        secret,
        { algorithm: 'HS256', issuer: ACCESS_TOKEN_ISSUER, expiresIn: 60 },
      );

      expect(createProvider(secret).verify(token)).toBeNull();
    });

    it.each([
      '',
      'texto qualquer',
      'a.b.c',
      `${faker.string.alphanumeric(40)}.x`,
    ])('o texto que não é um token: "%s"', (text) => {
      expect(createProvider().verify(text)).toBeNull();
    });
  });
});

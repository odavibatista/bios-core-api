import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { faker } from '@test/support/faker.js';
import { NotAuthenticatedException } from '../../domain/dtos/errors/not-authenticated.exception.js';
import type { UserSessionLink } from '../../domain/dtos/repositories/user-session.repository.js';
import type { AccessTokenClaims } from '../../domain/providers/access-token.provider.js';
import { AccessTokenGuard } from './access-token.guard.js';

describe('AccessTokenGuard', () => {
  const reflector = { getAllAndOverride: vi.fn() };
  const accessTokenProvider = { verify: vi.fn() };
  const userSessionRepository = { findById: vi.fn() };
  let guard: AccessTokenGuard;

  const token = faker.string.alphanumeric(120);

  function buildClaims(): AccessTokenClaims {
    return {
      userId: faker.database.mongodbObjectId(),
      sessionId: faker.database.mongodbObjectId(),
      role: faker.helpers.objectValue(UserRole),
    };
  }

  function buildSession(
    claims: AccessTokenClaims,
    overrides: Partial<UserSessionLink> = {},
  ): UserSessionLink {
    return {
      id: claims.sessionId,
      userId: claims.userId,
      familyId: faker.string.uuid(),
      expiresAt: faker.date.soon({ days: 5 }),
      revokedAt: null,
      revocationReason: null,
      ...overrides,
    };
  }

  function contextOf(headers: Record<string, unknown>) {
    const request: Record<string, unknown> = { headers };
    const context = {
      getHandler: () => 'handler',
      getClass: () => 'class',
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;

    return { context, request };
  }

  beforeEach(() => {
    reflector.getAllAndOverride.mockReturnValue(undefined);
    accessTokenProvider.verify.mockReturnValue(null);
    userSessionRepository.findById.mockResolvedValue(null);

    guard = new AccessTokenGuard(
      reflector as unknown as Reflector,
      accessTokenProvider as never,
      userSessionRepository as never,
    );
  });

  describe('rota pública', () => {
    it('libera sem token e sem consultar sessão', async () => {
      reflector.getAllAndOverride.mockReturnValue(true);
      const { context } = contextOf({});

      await expect(guard.canActivate(context)).resolves.toBe(true);

      expect(accessTokenProvider.verify).not.toHaveBeenCalled();
      expect(userSessionRepository.findById).not.toHaveBeenCalled();
    });

    it('lê a marca no método e na classe', async () => {
      const { context } = contextOf({});

      await guard.canActivate(context).catch(() => undefined);

      expect(reflector.getAllAndOverride).toHaveBeenCalledWith(
        'bios:is-public-route',
        ['handler', 'class'],
      );
    });
  });

  describe('sessão válida', () => {
    it('libera e registra o usuário autenticado na requisição', async () => {
      const claims = buildClaims();
      const session = buildSession(claims);
      accessTokenProvider.verify.mockReturnValue(claims);
      userSessionRepository.findById.mockResolvedValue(session);
      const { context, request } = contextOf({
        authorization: `Bearer ${token}`,
      });

      await expect(guard.canActivate(context)).resolves.toBe(true);

      expect(request.user).toEqual({
        userId: claims.userId,
        sessionId: session.id,
        familyId: session.familyId,
        role: claims.role,
      });
    });

    it('confere o token informado e consulta o elo do `sid`', async () => {
      const claims = buildClaims();
      accessTokenProvider.verify.mockReturnValue(claims);
      userSessionRepository.findById.mockResolvedValue(buildSession(claims));
      const { context } = contextOf({ authorization: `Bearer ${token}` });

      await guard.canActivate(context);

      expect(accessTokenProvider.verify).toHaveBeenCalledWith(token);
      expect(userSessionRepository.findById).toHaveBeenCalledWith(
        claims.sessionId,
      );
    });

    it.each([
      ['bearer em minúsculas', 'bearer'],
      ['BEARER em maiúsculas', 'BEARER'],
    ])('aceita o esquema com %s', async (_case, scheme) => {
      const claims = buildClaims();
      accessTokenProvider.verify.mockReturnValue(claims);
      userSessionRepository.findById.mockResolvedValue(buildSession(claims));
      const { context } = contextOf({ authorization: `${scheme} ${token}` });

      await expect(guard.canActivate(context)).resolves.toBe(true);
    });
  });

  describe('recusa com 401 genérico', () => {
    async function expectRefused(headers: Record<string, unknown>) {
      const { context } = contextOf(headers);

      await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
        NotAuthenticatedException,
      );
    }

    it.each([
      ['sem cabeçalho Authorization', {}],
      ['com esquema diferente de Bearer', { authorization: `Basic ${token}` }],
      ['com Bearer sem token', { authorization: 'Bearer ' }],
      ['com token seguido de lixo', { authorization: `Bearer ${token} extra` }],
      ['com cabeçalho repetido', { authorization: [`Bearer ${token}`, 'x'] }],
    ])('requisição %s', async (_case, headers) => {
      await expectRefused(headers);

      expect(accessTokenProvider.verify).not.toHaveBeenCalledWith(undefined);
    });

    it('token que a verificação não aceita (adulterado, expirado, outro emissor)', async () => {
      accessTokenProvider.verify.mockReturnValue(null);

      await expectRefused({ authorization: `Bearer ${token}` });

      expect(userSessionRepository.findById).not.toHaveBeenCalled();
    });

    it('elo inexistente', async () => {
      accessTokenProvider.verify.mockReturnValue(buildClaims());
      userSessionRepository.findById.mockResolvedValue(null);

      await expectRefused({ authorization: `Bearer ${token}` });
    });

    it.each([
      ['LOGOUT'],
      ['LOGOUT_ALL_DEVICES'],
      ['PASSWORD_CHANGE'],
      ['REUSE_DETECTED'],
      ['ROTATED'],
    ] as const)(
      'elo revogado (%s): a revogação vale de imediato',
      async (reason) => {
        const claims = buildClaims();
        accessTokenProvider.verify.mockReturnValue(claims);
        userSessionRepository.findById.mockResolvedValue(
          buildSession(claims, {
            revokedAt: faker.date.recent(),
            revocationReason: reason,
          }),
        );

        await expectRefused({ authorization: `Bearer ${token}` });
      },
    );

    it('elo cujo prazo acabou, mesmo com o access token ainda dentro da validade', async () => {
      const claims = buildClaims();
      accessTokenProvider.verify.mockReturnValue(claims);
      userSessionRepository.findById.mockResolvedValue(
        buildSession(claims, { expiresAt: faker.date.past() }),
      );

      await expectRefused({ authorization: `Bearer ${token}` });
    });

    it('elo de outro usuário que o token afirma', async () => {
      const claims = buildClaims();
      accessTokenProvider.verify.mockReturnValue(claims);
      userSessionRepository.findById.mockResolvedValue(
        buildSession(claims, { userId: faker.database.mongodbObjectId() }),
      );

      await expectRefused({ authorization: `Bearer ${token}` });
    });

    it('não registra usuário na requisição recusada', async () => {
      const claims = buildClaims();
      accessTokenProvider.verify.mockReturnValue(claims);
      userSessionRepository.findById.mockResolvedValue(
        buildSession(claims, { revokedAt: faker.date.recent() }),
      );
      const { context, request } = contextOf({
        authorization: `Bearer ${token}`,
      });

      await guard.canActivate(context).catch(() => undefined);

      expect(request.user).toBeUndefined();
    });

    it('propaga a falha do banco em vez de liberar', async () => {
      accessTokenProvider.verify.mockReturnValue(buildClaims());
      userSessionRepository.findById.mockRejectedValue(new Error('banco fora'));
      const { context } = contextOf({ authorization: `Bearer ${token}` });

      // Sem consultar o elo, não há como saber se a sessão vale: nunca libera.
      await expect(guard.canActivate(context)).rejects.toThrow('banco fora');
    });
  });
});

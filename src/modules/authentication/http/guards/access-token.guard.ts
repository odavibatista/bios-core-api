import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedUser } from '@shared/domain/dtos/authenticated-user.dto.js';
import { AUTHENTICATED_USER_KEY } from '@shared/http/decorators/current-user.decorator.js';
import { IS_PUBLIC_ROUTE } from '@shared/http/decorators/public.decorator.js';
import { NotAuthenticatedException } from '../../domain/dtos/errors/not-authenticated.exception.js';
import { UserSessionRepository } from '../../domain/dtos/repositories/user-session.repository.js';
import { AccessTokenProvider } from '../../domain/providers/access-token.provider.js';

/** Esquema do cabeçalho `Authorization` aceito. */
const BEARER_PATTERN = /^Bearer\s+(\S+)$/i;

/**
 * Guard global de autenticação (NFSE05, UC03).
 *
 * Toda rota exige sessão, exceto as marcadas com `@Public()`. Para as demais,
 * o access token precisa estar assinado, no prazo **e** corresponder a um elo
 * de sessão que continue ativo: a assinatura prova que o BIOS emitiu o token,
 * e a consulta ao elo é o que dá efeito imediato ao logout, à troca de senha e
 * à detecção de reuso, sem esperar o token expirar.
 *
 * O elo precisa ainda ser do usuário que o token afirma e estar dentro da
 * validade do refresh token: uma sessão cujo prazo acabou não se sustenta num
 * access token que ainda não venceu.
 *
 * Qualquer falha responde o mesmo `401`, sem dizer o motivo.
 */
@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly accessTokenProvider: AccessTokenProvider,
    private readonly userSessionRepository: UserSessionRepository,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(
      IS_PUBLIC_ROUTE,
      [context.getHandler(), context.getClass()],
    );

    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<{
      headers: Record<string, string | string[] | undefined>;
      [AUTHENTICATED_USER_KEY]?: AuthenticatedUser;
    }>();
    const token = bearerTokenOf(request.headers.authorization);
    const claims = token ? this.accessTokenProvider.verify(token) : null;

    if (!claims) throw new NotAuthenticatedException();

    const session = await this.userSessionRepository.findById(claims.sessionId);

    if (
      !session ||
      session.revokedAt ||
      session.expiresAt <= new Date() ||
      session.userId !== claims.userId
    ) {
      throw new NotAuthenticatedException();
    }

    request[AUTHENTICATED_USER_KEY] = {
      userId: claims.userId,
      sessionId: session.id,
      familyId: session.familyId,
      role: claims.role,
    };

    return true;
  }
}

/** Token do cabeçalho `Authorization: Bearer <token>`, ou `undefined`. */
function bearerTokenOf(
  header: string | string[] | undefined,
): string | undefined {
  return typeof header === 'string'
    ? BEARER_PATTERN.exec(header.trim())?.[1]
    : undefined;
}

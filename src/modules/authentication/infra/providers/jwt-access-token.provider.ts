import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '@prisma/client';
import type { Environment } from '@shared/config/environment.config.js';
import jsonwebtoken from 'jsonwebtoken';
import {
  type AccessTokenClaims,
  AccessTokenProvider,
  type SignedAccessToken,
} from '../../domain/providers/access-token.provider.js';

/** Algoritmo único aceito na assinatura e na verificação. */
const ALGORITHM = 'HS256';

/** Emissor gravado no token e exigido na verificação. */
export const ACCESS_TOKEN_ISSUER = 'bios-core-api';

const ROLES: readonly string[] = Object.values(UserRole);

/**
 * Access token JWT assinado com HMAC-SHA256 (NFSE05).
 *
 * O `sub` é o usuário, o `sid` é o elo da sessão e o `role` o papel — o
 * suficiente para identificar a requisição sem consultar a conta. Quem decide
 * se a sessão ainda vale é o servidor, comparando o `sid` com o elo no banco.
 *
 * **O algoritmo é fixado na verificação.** Aceitar o que o cabeçalho do token
 * declara permitiria `alg: none`, ou a troca por um algoritmo assimétrico em
 * que a "chave pública" fosse o próprio segredo.
 */
@Injectable()
export class JwtAccessTokenProvider extends AccessTokenProvider {
  private readonly secret: Buffer;
  private readonly lifetimeSeconds: number;

  constructor(configService: ConfigService<Environment, true>) {
    super();
    this.secret = configService.get('AUTH_ACCESS_TOKEN_SECRET', {
      infer: true,
    });
    this.lifetimeSeconds = configService
      .get('AUTH_ACCESS_TOKEN_LIFETIME', { infer: true })
      .toSeconds();
  }

  override sign({
    userId,
    sessionId,
    role,
  }: AccessTokenClaims): SignedAccessToken {
    const token = jsonwebtoken.sign({ sid: sessionId, role }, this.secret, {
      algorithm: ALGORITHM,
      issuer: ACCESS_TOKEN_ISSUER,
      subject: userId,
      expiresIn: this.lifetimeSeconds,
    });

    return { token, expiresInSeconds: this.lifetimeSeconds };
  }

  override verify(token: string): AccessTokenClaims | null {
    try {
      const payload = jsonwebtoken.verify(token, this.secret, {
        algorithms: [ALGORITHM],
        issuer: ACCESS_TOKEN_ISSUER,
      });

      return typeof payload === 'string' ? null : toClaims(payload);
    } catch {
      return null;
    }
  }
}

/** Reconhece as afirmações do BIOS; token de forma diferente não é aceito. */
function toClaims(payload: jsonwebtoken.JwtPayload): AccessTokenClaims | null {
  const { sub, sid, role } = payload as Record<string, unknown>;

  if (
    typeof sub !== 'string' ||
    typeof sid !== 'string' ||
    typeof role !== 'string' ||
    !ROLES.includes(role)
  ) {
    return null;
  }

  return { userId: sub, sessionId: sid, role: role as UserRole };
}

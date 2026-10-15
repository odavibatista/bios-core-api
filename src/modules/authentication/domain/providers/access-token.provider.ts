import type { UserRole } from '@prisma/client';

/** O que o access token afirma sobre quem o apresenta. */
export interface AccessTokenClaims {
  /** Usuário dono da sessão. */
  userId: string;

  /** Elo da sessão (`sid`): o token só vale enquanto o elo estiver ativo. */
  sessionId: string;

  role: UserRole;
}

/** Access token assinado. */
export interface SignedAccessToken {
  token: string;

  /** Vida do token, em segundos, para o `expires_in` da resposta. */
  expiresInSeconds: number;
}

/**
 * Contrato do access token (NFSE05).
 *
 * O token apenas identifica a sessão; quem decide se ela ainda vale é o
 * servidor, consultando o elo a cada requisição. Por isso a vida é curta e a
 * revogação tem efeito imediato.
 *
 * Classe abstrata (e não interface) para servir também como token de injeção.
 */
export abstract class AccessTokenProvider {
  abstract sign(claims: AccessTokenClaims): SignedAccessToken;

  /**
   * Confere assinatura, emissor e validade.
   *
   * Devolve `null` para qualquer token que não possa ser aceito — malformado,
   * adulterado, de outro emissor ou expirado. O motivo não é distinguido: para
   * quem chama, todos significam "sessão inválida".
   */
  abstract verify(token: string): AccessTokenClaims | null;
}

import type { SessionRevocationReason } from '@prisma/client';

/** Elo de sessão a registrar. */
export interface NewUserSession {
  userId: string;

  /** Família de rotação: todos os elos originados do mesmo login (um dispositivo). */
  familyId: string;

  /** Resumo SHA-256 do refresh token deste elo. */
  refreshTokenHash: string;

  /** IP de origem. */
  ip: string;

  /** User-agent de origem, quando informado. */
  userAgent?: string;

  /** Momento em que o refresh token deixa de valer. */
  expiresAt: Date;
}

/** Elo de sessão existente, como a renovação precisa vê-lo. */
export interface UserSessionLink {
  id: string;
  userId: string;
  familyId: string;
  expiresAt: Date;

  /** Momento da revogação; `null` enquanto o elo está ativo. */
  revokedAt: Date | null;

  /** Motivo da revogação; `null` enquanto o elo está ativo. */
  revocationReason: SessionRevocationReason | null;
}

/** Troca de um elo ativo pelo seguinte da mesma família. */
export interface SessionRotation {
  /** Elo a revogar como `ROTATED`. */
  currentSessionId: string;

  /** Elo que o substitui; nasce na família do atual. */
  next: NewUserSession;

  /** Instante da troca, contra o qual a validade do elo atual é conferida. */
  now: Date;
}

/**
 * Contrato das sessões de usuário (RF32, NFSE05).
 *
 * Classe abstrata (e não interface) para servir também como token de injeção.
 */
export abstract class UserSessionRepository {
  /**
   * Registra um elo de sessão e devolve seu identificador, que o access token
   * carrega como `sid`.
   */
  abstract create(session: NewUserSession): Promise<string>;

  /** Localiza o elo pelo resumo do refresh token. */
  abstract findByRefreshTokenHash(
    refreshTokenHash: string,
  ): Promise<UserSessionLink | null>;

  /**
   * Revoga o elo atual como `ROTATED` e cria o seguinte, de forma atômica.
   *
   * A revogação só acontece se o elo ainda estiver ativo e dentro da validade.
   * Devolve o identificador do novo elo, ou `null` quando o elo atual já não
   * estava ativo — o que, numa renovação, só acontece se outro pedido o
   * consumiu antes (uso concorrente do mesmo token) e deve ser tratado como
   * reuso. Nesse caso nada é criado.
   */
  abstract rotate(rotation: SessionRotation): Promise<string | null>;

  /**
   * Revoga todos os elos ativos do usuário, de todas as famílias, e devolve
   * quantos eram.
   */
  abstract revokeAllActive(
    userId: string,
    reason: SessionRevocationReason,
    revokedAt: Date,
  ): Promise<number>;
}

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
}

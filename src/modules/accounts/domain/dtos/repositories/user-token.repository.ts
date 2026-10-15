import type { UserToken, UserTokenPurpose } from '@prisma/client';

/** Dados de um token a registrar. O valor puro nunca chega ao repositório: só o resumo. */
export interface NewUserToken {
  /** Usuário dono do token. */
  userId: string;

  /** Finalidade do token. */
  purpose: UserTokenPurpose;

  /** Resumo SHA-256 do token enviado por e-mail. */
  tokenHash: string;

  /** Momento em que o token deixa de valer. */
  expiresAt: Date;

  /** Novo e-mail já cifrado; só para a troca de e-mail (RF26). */
  pendingEmailEncrypted?: string;
}

/** Pedido para consumir um token apresentado pelo usuário. */
export interface UserTokenConsumption {
  /** Resumo do token recebido. */
  tokenHash: string;

  /** Finalidade esperada: um token só vale para a ação para a qual foi emitido. */
  purpose: UserTokenPurpose;

  /** Instante da apresentação, contra o qual a validade é conferida. */
  now: Date;
}

/**
 * Contrato dos tokens de uso único enviados por e-mail (RF25, RF26, RF28).
 *
 * Classe abstrata (e não interface) para servir também como token de injeção.
 */
export abstract class UserTokenRepository {
  /**
   * Registra um token e invalida os ainda pendentes da mesma finalidade e do
   * mesmo usuário, de forma atômica: pedir um novo link torna o anterior inútil,
   * e nunca há dois links válidos para a mesma ação.
   */
  abstract replacePending(token: NewUserToken): Promise<void>;

  /**
   * Consome o token: marca-o como usado e o devolve.
   *
   * Devolve `null` quando o token não existe, é de outra finalidade, está
   * expirado ou já foi usado. A marcação é condicional ao token ainda estar
   * livre, então duas requisições simultâneas com o mesmo link nunca passam
   * as duas: uma recebe o token, a outra recebe `null`.
   */
  abstract consume(
    consumption: UserTokenConsumption,
  ): Promise<UserToken | null>;
}

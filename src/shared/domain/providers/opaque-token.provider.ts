/**
 * Token opaco recém-gerado: o valor que vai ao usuário e o resumo que fica
 * no banco.
 */
export interface GeneratedOpaqueToken {
  /**
   * Valor puro, em base64url (seguro em URL). Existe só neste retorno: é
   * entregue ao usuário (link de e-mail, refresh token) e nunca persistido.
   */
  token: string;

  /** Resumo SHA-256 em hexadecimal, a ser persistido e usado na busca. */
  hash: string;
}

/**
 * Contrato dos tokens opacos de uso único (links de e-mail, refresh tokens).
 *
 * Opaco porque não carrega dado: é só uma sequência aleatória que o servidor
 * reconhece pelo resumo guardado. Diferente de um JWT, pode ser revogado e
 * consumido no servidor, e um vazamento do banco expõe apenas resumos — que
 * não permitem reconstituir um link ainda válido.
 *
 * Classe abstrata (e não interface) para servir também como token de injeção.
 */
export abstract class OpaqueTokenProvider {
  /** Sorteia um token novo e devolve o valor puro com seu resumo. */
  abstract generate(): GeneratedOpaqueToken;

  /** Resumo de um token recebido, para localizá-lo no banco. */
  abstract hash(token: string): string;
}

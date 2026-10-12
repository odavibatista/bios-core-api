/**
 * Valor cifrado junto da versão da chave usada.
 *
 * A versão é persistida ao lado do texto cifrado (`encryption_key_version` nos
 * documentos) para que a rotação de chave seja gradual: documentos antigos
 * continuam legíveis enquanto as novas escritas já usam a chave ativa.
 */
export interface EncryptedValue {
  /** Texto cifrado em base64url (IV, tag de autenticação e criptograma). */
  ciphertext: string;

  /** Versão da chave usada na cifragem. */
  keyVersion: number;
}

/**
 * Contrato de criptografia simétrica de dados sensíveis (NFSE03).
 *
 * Classe abstrata (e não interface) para servir também como token de injeção.
 */
export abstract class EncryptionProvider {
  /** Versão da chave usada nas novas cifragens. */
  abstract readonly activeKeyVersion: number;

  /**
   * Cifra um valor com a chave ativa.
   *
   * Duas chamadas com o mesmo valor produzem criptogramas diferentes: o IV é
   * sorteado por operação, de modo que o texto cifrado não revela repetição.
   */
  abstract encrypt(plaintext: string): EncryptedValue;

  /**
   * Decifra um valor, verificando sua integridade.
   *
   * @throws {EncryptionException} quando o texto foi adulterado ou a versão de
   * chave informada não está configurada.
   */
  abstract decrypt(value: EncryptedValue): string;

  /**
   * Índice cego de um valor: hash determinístico que permite localizar um
   * documento por igualdade sem decifrar a coleção (ex.: achar a conta pelo
   * e-mail no login).
   *
   * Não é reversível e não substitui a cifragem: o valor continua sendo
   * armazenado cifrado, e o índice cego é apenas a chave de busca.
   */
  abstract blindIndex(value: string): string;
}

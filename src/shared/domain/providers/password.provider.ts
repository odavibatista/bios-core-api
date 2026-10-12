import type { EncryptedValue } from './encryption.provider.js';

/**
 * Contrato de proteção de senha em duas camadas (NFSE03).
 *
 * A senha passa por hash e o hash é cifrado: um vazamento do banco sem a chave
 * de cifragem não expõe nem o hash, o que impede ataques de dicionário offline.
 *
 * O resultado é um `EncryptedValue` — o mesmo tipo devolvido pela cifragem de
 * e-mail e endereço — para que o documento do usuário grave uma única
 * `encryption_key_version` para todos os seus campos protegidos.
 *
 * Classe abstrata (e não interface) para servir também como token de injeção.
 */
export abstract class PasswordProvider {
  /** Gera o valor a ser persistido em `users.password_encrypted`. */
  abstract hash(plaintext: string): Promise<EncryptedValue>;

  /**
   * Confere a senha informada contra o valor persistido.
   *
   * Devolve `false` para senha incorreta. Lança quando o valor armazenado não
   * pode ser lido (adulterado, ou cifrado com versão de chave ausente): um
   * problema de configuração ou de integridade não deve ser confundido com
   * credencial inválida.
   *
   * @throws {EncryptionException} quando o valor armazenado não pode ser decifrado.
   */
  abstract verify(plaintext: string, stored: EncryptedValue): Promise<boolean>;
}

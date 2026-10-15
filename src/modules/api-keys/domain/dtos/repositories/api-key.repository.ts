/** Chave a registrar. O valor completo nunca chega ao repositório: só o resumo. */
export interface NewApiKey {
  userId: string;

  /** Nome de identificação escolhido pelo usuário. */
  name: string;

  /** Prefixo público (`bios_<identificador>`). */
  prefix: string;

  /** Resumo SHA-256 da chave completa. */
  hash: string;
}

/** Chave ativa, como a listagem a exibe: nada que permita reconstituí-la. */
export interface ActiveApiKey {
  id: string;
  name: string;
  prefix: string;
  createdAt: Date;

  /** Último uso; `null` enquanto nunca foi usada. */
  lastUsedAt: Date | null;
}

/**
 * Contrato das chaves de API (RF16, NFSE01).
 *
 * Classe abstrata (e não interface) para servir também como token de injeção.
 */
export abstract class ApiKeyRepository {
  /**
   * Registra a chave.
   *
   * Devolve `null` quando o prefixo ou o resumo já existem — coincidência
   * improvável, mas a unicidade é do banco e não de uma consulta prévia —, e
   * quem chamou gera outra.
   */
  abstract create(key: NewApiKey): Promise<ActiveApiKey | null>;

  /** Quantas chaves do usuário ainda não foram revogadas. */
  abstract countActive(userId: string): Promise<number>;

  /** Chaves ainda não revogadas do usuário, da mais nova para a mais antiga. */
  abstract listActive(userId: string): Promise<ActiveApiKey[]>;

  /**
   * Revoga a chave do usuário com efeito imediato.
   *
   * Devolve `false` quando a chave não existe, já estava revogada ou é de outro
   * usuário — a condição de posse faz parte da própria escrita, de modo que um
   * identificador alheio não revoga nada.
   */
  abstract revoke(
    userId: string,
    apiKeyId: string,
    revokedAt: Date,
  ): Promise<boolean>;
}

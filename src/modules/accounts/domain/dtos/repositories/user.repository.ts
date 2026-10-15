import type { UserRole } from '@prisma/client';

/** Dados de uma conta nova. Tudo que é pessoal chega já protegido. */
export interface NewUser {
  /** Nome de exibição. */
  name: string;

  /** E-mail cifrado com AES-256. */
  emailEncrypted: string;

  /** Índice cego do e-mail normalizado: chave de busca e de unicidade. */
  emailHash: string;

  /** Hash bcrypt da senha, cifrado com AES-256. */
  passwordEncrypted: string;

  /** Versão da chave que cifrou os campos acima. */
  encryptionKeyVersion: number;
}

/** O que o fluxo de confirmação precisa saber de uma conta existente. */
export interface AccountIdentity {
  id: string;
  name: string;
  isActive: boolean;
}

/** O que a autenticação precisa de uma conta para conferir a senha e abrir a sessão. */
export interface AccountCredentials extends AccountIdentity {
  role: UserRole;

  /** Hash bcrypt da senha, cifrado com AES-256. */
  passwordEncrypted: string;

  /** Versão da chave que cifrou `passwordEncrypted`. */
  encryptionKeyVersion: number;
}

/** Campos cifrados da conta e a versão da chave que os cifrou, para trocar a senha. */
export interface AccountSecrets {
  /** Hash bcrypt da senha, cifrado com AES-256. */
  passwordEncrypted: string;

  /** E-mail cifrado com AES-256. */
  emailEncrypted: string;

  /** Endereço cifrado com AES-256; ausente quando a conta não informou. */
  addressEncrypted: string | null;

  /** Versão da chave que cifrou todos os campos acima. */
  encryptionKeyVersion: number;
}

/**
 * Nova senha a gravar.
 *
 * A conta tem **uma** versão de chave para todos os campos cifrados. Quando a
 * senha nova é cifrada com uma chave mais recente que a do documento, o e-mail
 * e o endereço precisam ser recifrados juntos: gravar só a senha deixaria o
 * documento com campos de versões diferentes e uma única versão registrada.
 */
export interface PasswordUpdate {
  passwordEncrypted: string;

  /** Versão da chave de todos os campos cifrados do documento após a gravação. */
  encryptionKeyVersion: number;

  changedAt: Date;

  /** E-mail recifrado; presente só quando a versão da chave mudou. */
  emailEncrypted?: string;

  /** Endereço recifrado; presente só quando a versão mudou e a conta tem endereço. */
  addressEncrypted?: string;
}

/** A conta como a renovação de sessão precisa vê-la: papel vigente e e-mail para o alerta. */
export interface AccountProfile extends AccountIdentity {
  role: UserRole;

  /** E-mail cifrado com AES-256. */
  emailEncrypted: string;

  /** Versão da chave que cifrou `emailEncrypted`. */
  encryptionKeyVersion: number;
}

/**
 * Contrato das contas de usuário (RF01, RF02, RF24, RF25, RF28).
 *
 * Classe abstrata (e não interface) para servir também como token de injeção.
 */
export abstract class UserRepository {
  /**
   * Cria uma conta inativa, com papel `USER`.
   *
   * Devolve o identificador da conta, ou `null` quando já existe conta com o
   * mesmo e-mail. A unicidade é decidida pelo índice único do banco, e não por
   * uma consulta prévia: duas requisições simultâneas com o mesmo e-mail não
   * criam duas contas.
   */
  abstract createInactive(user: NewUser): Promise<string | null>;

  /** Localiza a conta pelo índice cego do e-mail. */
  abstract findByEmailHash(emailHash: string): Promise<AccountIdentity | null>;

  /**
   * Ativa a conta e registra a confirmação do e-mail.
   *
   * Devolve `false` quando não há conta inativa com esse identificador (já
   * ativada ou excluída), sem tratar como erro: confirmar duas vezes é inócuo.
   */
  abstract activate(userId: string, confirmedAt: Date): Promise<boolean>;

  /**
   * Localiza a conta, com o que é preciso para autenticá-la, pelo índice cego
   * do e-mail.
   */
  abstract findCredentialsByEmailHash(
    emailHash: string,
  ): Promise<AccountCredentials | null>;

  /** Localiza a conta pelo identificador, com o papel vigente e o e-mail cifrado. */
  abstract findProfileById(userId: string): Promise<AccountProfile | null>;

  /** Lê os campos cifrados da conta, com a versão da chave, para trocar a senha. */
  abstract findSecretsById(userId: string): Promise<AccountSecrets | null>;

  /**
   * Grava a nova senha e a data da troca.
   *
   * Devolve `false` quando a conta não existe mais.
   */
  abstract updatePassword(
    userId: string,
    update: PasswordUpdate,
  ): Promise<boolean>;

  /** Registra a data/hora do último login bem-sucedido. */
  abstract recordLogin(userId: string, loggedInAt: Date): Promise<void>;
}

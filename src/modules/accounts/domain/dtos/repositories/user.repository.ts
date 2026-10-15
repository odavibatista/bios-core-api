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

/** A conta como a renovação de sessão precisa vê-la: papel vigente e e-mail para o alerta. */
export interface AccountProfile extends AccountIdentity {
  role: UserRole;

  /** E-mail cifrado com AES-256. */
  emailEncrypted: string;

  /** Versão da chave que cifrou `emailEncrypted`. */
  encryptionKeyVersion: number;
}

/**
 * Contrato das contas de usuário (RF01, RF02, RF28).
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

  /** Registra a data/hora do último login bem-sucedido. */
  abstract recordLogin(userId: string, loggedInAt: Date): Promise<void>;
}

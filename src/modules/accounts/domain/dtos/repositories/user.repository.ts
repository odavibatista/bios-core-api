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

/** Campos cifrados da conta e a versão da chave que os cifrou. */
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
 * Alteração de uma conta, aplicada de forma atômica.
 *
 * A conta tem **uma** versão de chave para todos os campos cifrados. Quem monta
 * a alteração é responsável por mantê-los coerentes: se a versão registrada
 * muda, todos os campos cifrados do documento precisam ter sido recifrados na
 * mesma alteração. `UpdateAccountUseCase` faz isso.
 *
 * Campos ausentes não são alterados.
 */
export interface UserUpdate {
  name?: string;

  /** E-mail cifrado; vem sempre junto de `emailHash`. */
  emailEncrypted?: string;

  /** Índice cego do novo e-mail normalizado. */
  emailHash?: string;

  /** Quando o novo e-mail foi confirmado. */
  emailConfirmedAt?: Date;

  passwordEncrypted?: string;
  passwordChangedAt?: Date;

  /** Endereço cifrado; `null` remove o endereço da conta. */
  addressEncrypted?: string | null;

  /** Versão da chave de todos os campos cifrados do documento após a gravação. */
  encryptionKeyVersion?: number;
}

/** Desfecho de uma alteração de conta. */
export const UserUpdateOutcome = {
  UPDATED: 'UPDATED',
  NOT_FOUND: 'NOT_FOUND',

  /** O novo e-mail pertence a outra conta (índice único do índice cego). */
  EMAIL_TAKEN: 'EMAIL_TAKEN',
} as const;

export type UserUpdateOutcome =
  (typeof UserUpdateOutcome)[keyof typeof UserUpdateOutcome];

/**
 * A conta como os fluxos autenticados precisam vê-la: papel vigente e os
 * campos pessoais cifrados.
 */
export interface AccountProfile extends AccountIdentity {
  role: UserRole;

  /** E-mail cifrado com AES-256. */
  emailEncrypted: string;

  /** Endereço cifrado com AES-256; ausente quando a conta não informou. */
  addressEncrypted: string | null;

  /** Versão da chave que cifrou os campos cifrados acima. */
  encryptionKeyVersion: number;
}

/**
 * Contrato das contas de usuário (RF01, RF02, RF24-RF28).
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

  /** Localiza a conta pelo identificador, com o papel vigente e os campos pessoais cifrados. */
  abstract findProfileById(userId: string): Promise<AccountProfile | null>;

  /** Lê os campos cifrados da conta, com a versão da chave. */
  abstract findSecretsById(userId: string): Promise<AccountSecrets | null>;

  /**
   * Aplica a alteração à conta, de uma só vez.
   *
   * Trocar o e-mail para um que já pertence a outra conta não altera nada e
   * devolve `EMAIL_TAKEN`: a unicidade é do índice único, não de uma consulta
   * prévia.
   */
  abstract update(
    userId: string,
    update: UserUpdate,
  ): Promise<UserUpdateOutcome>;

  /**
   * Exclui a conta e tudo que depende dela (RF27, LGPD).
   *
   * Sessões, tokens, chaves de API e bloqueios saem junto. As tentativas de
   * login ficam, desvinculadas do titular (só IP e data/hora), e os registros
   * de e-mails enviados a ele são apagados. Devolve `false` quando a conta já
   * não existia.
   */
  abstract delete(userId: string): Promise<boolean>;

  /** Registra a data/hora do último login bem-sucedido. */
  abstract recordLogin(userId: string, loggedInAt: Date): Promise<void>;
}

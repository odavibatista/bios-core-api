import type { LoginFailureReason } from '@prisma/client';
import type { AccessBlockTarget } from '@modules/security/domain/dtos/repositories/access-block.repository.js';

/** Tentativa malsucedida a registrar. */
export interface FailedLoginAttempt {
  /** Conta visada; ausente quando o e-mail não corresponde a conta alguma. */
  userId?: string;

  /** IP de origem. */
  ip: string;

  reason: LoginFailureReason;
}

/** Tentativa bem-sucedida a registrar. */
export interface SuccessfulLoginAttempt {
  userId: string;
  ip: string;
}

/**
 * Contrato do registro de tentativas de login (RF19).
 *
 * Classe abstrata (e não interface) para servir também como token de injeção.
 */
export abstract class LoginAttemptRepository {
  abstract recordFailure(attempt: FailedLoginAttempt): Promise<void>;

  abstract recordSuccess(attempt: SuccessfulLoginAttempt): Promise<void>;

  /**
   * Falhas de senha consecutivas do alvo (RF20).
   *
   * Conta as tentativas com credenciais inválidas posteriores ao último login
   * bem-sucedido do alvo e a `notBefore`, o que vier por último. Um login
   * correto zera a contagem, e um bloqueio também: as falhas que o causaram já
   * foram punidas. Tentativas recusadas por bloqueio ou por conta não
   * confirmada não são erro de senha e não entram.
   */
  abstract countFailuresSinceLastSuccess(
    target: AccessBlockTarget,
    notBefore: Date | null,
  ): Promise<number>;
}

import type { AccessBlockReason, AccessBlockScope } from '@prisma/client';

/**
 * Alvo de um bloqueio: um endereço IP ou uma conta de usuário.
 *
 * A mesma forma serve para consultar bloqueios e para contar tentativas de
 * login, de modo que o alvo que acumula as falhas é o que recebe o bloqueio.
 */
export type AccessBlockTarget =
  | { scope: typeof AccessBlockScope.IP; ip: string }
  | { scope: typeof AccessBlockScope.USER; userId: string };

/** Bloqueio em vigor. */
export interface ActiveAccessBlock {
  /** Fim do bloqueio; `null` indica bloqueio sem prazo (honeypot). */
  blockedUntil: Date | null;
}

/** Bloqueio a registrar. */
export interface NewAccessBlock {
  target: AccessBlockTarget;
  reason: AccessBlockReason;

  /** Fim do bloqueio; `null` para bloqueio sem prazo. */
  blockedUntil: Date | null;
}

/**
 * Contrato dos bloqueios de acesso (RF20, RF21).
 *
 * O banco é a fonte de verdade e a trilha de auditoria dos bloqueios.
 *
 * Classe abstrata (e não interface) para servir também como token de injeção.
 */
export abstract class AccessBlockRepository {
  /**
   * Bloqueio em vigor para qualquer um dos alvos, ou `null` se nenhum está
   * bloqueado. Com mais de um, devolve o que dura mais: o acesso só volta
   * quando todos terminam.
   */
  abstract findActive(
    targets: readonly AccessBlockTarget[],
    now: Date,
  ): Promise<ActiveAccessBlock | null>;

  /** Registra um bloqueio. */
  abstract create(block: NewAccessBlock): Promise<void>;

  /**
   * Início do bloqueio por tentativas de login mais recente do alvo, ou `null`
   * se nunca houve.
   *
   * Marca onde recomeça a contagem de falhas: depois de um bloqueio, as falhas
   * anteriores a ele já foram punidas e não contam de novo.
   */
  abstract findLastLoginBlockStart(
    target: AccessBlockTarget,
  ): Promise<Date | null>;
}

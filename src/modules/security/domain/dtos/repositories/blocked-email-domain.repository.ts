/**
 * Contrato de consulta à blacklist de domínios de e-mail (RF22).
 *
 * Classe abstrata (e não interface) para servir também como token de injeção.
 */
export abstract class BlockedEmailDomainRepository {
  /**
   * Indica se o domínio está bloqueado agora.
   *
   * Domínio com remoção lógica (`deleted_at` preenchido) não bloqueia: o
   * registro permanece para que uma reinclusão o restaure (RF29).
   *
   * @param domain domínio normalizado, em minúsculas e sem `@`.
   */
  abstract isBlocked(domain: string): Promise<boolean>;
}

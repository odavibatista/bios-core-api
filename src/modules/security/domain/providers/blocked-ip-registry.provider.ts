/**
 * IPs bloqueados sem prazo (honeypot, RF21), consultados a cada requisição.
 *
 * O banco (`access_blocks`) é a fonte de verdade; esta é a consulta rápida que a recusa em
 * toda rota exige. Classe abstrata (e não interface) para servir também como token de
 * injeção.
 */
export abstract class BlockedIpRegistry {
  /** Indica se o IP está bloqueado sem prazo. */
  abstract isBlocked(ip: string): Promise<boolean>;

  /** Passa a recusar o IP em toda rota (o bloqueio já está gravado no banco). */
  abstract add(ip: string): Promise<void>;
}

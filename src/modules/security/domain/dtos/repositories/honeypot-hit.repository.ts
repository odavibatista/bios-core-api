/** Chamada a um endpoint isca (RF21), como é registrada. */
export interface NewHoneypotHit {
  ip: string;
  endpoint: string;
  httpMethod: string;
  userAgent: string | null;
}

/**
 * Contrato do registro das chamadas a endpoints isca (`honeypot_hits`, RF21).
 *
 * Classe abstrata (e não interface) para servir também como token de injeção.
 */
export abstract class HoneypotHitRepository {
  abstract record(hit: NewHoneypotHit): Promise<void>;
}

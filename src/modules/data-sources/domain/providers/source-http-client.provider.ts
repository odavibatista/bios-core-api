/** Chamada HTTP já com a URL montada. */
export interface SourceHttpRequest {
  url: string;
  headers: Readonly<Record<string, string>>;

  /** Tempo máximo da chamada inteira, resposta lida incluída. */
  timeoutMs: number;
}

/**
 * Resultado de uma chamada HTTP. O cliente nunca lança: quem decide o que
 * fazer com cada desfecho é o caso de uso, que também o registra no log.
 */
export type SourceHttpResult =
  /** A fonte respondeu. `json` só vem preenchido em resposta 2xx com corpo JSON válido. */
  | { kind: 'RESPONSE'; status: number; json?: unknown }
  /** O tempo máximo se esgotou antes da resposta completa. */
  | { kind: 'TIMEOUT' }
  /** Falha de rede, corpo grande demais ou fora do formato. */
  | { kind: 'FAILED'; message: string };

/**
 * Contrato do cliente HTTP das fontes externas.
 *
 * Classe abstrata (e não interface) para servir também como token de injeção.
 */
export abstract class SourceHttpClient {
  /** `GET` com tempo máximo, sem seguir redirecionamentos. */
  abstract get(request: SourceHttpRequest): Promise<SourceHttpResult>;
}

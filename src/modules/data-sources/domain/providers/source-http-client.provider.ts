/** Chamada HTTP já com a URL montada. */
export interface SourceHttpRequest {
  url: string;
  headers: Readonly<Record<string, string>>;

  /** Tempo máximo da chamada inteira, resposta lida incluída. */
  timeoutMs: number;
}

/**
 * Download de um arquivo grande (um dump em lote), gravado em disco em vez de
 * lido para a memória.
 */
export interface SourceDownloadRequest extends SourceHttpRequest {
  /** Caminho do arquivo a gravar. Quem pede o escolhe e o remove depois. */
  destination: string;

  /** Maior tamanho aceito, em bytes: passado disso, o download é abortado. */
  maxBytes: number;
}

/** Arquivo baixado: onde está, quanto pesa e o resumo do conteúdo. */
export interface SourceDownloadedFile {
  path: string;
  bytes: number;

  /** SHA-256 do conteúdo, em hexadecimal: identifica o dump entre execuções. */
  checksum: string;
}

/**
 * Resultado de uma chamada HTTP. O cliente nunca lança: quem decide o que
 * fazer com cada desfecho é o caso de uso, que também o registra no log.
 */
export type SourceHttpResult =
  /**
   * A fonte respondeu. `json` só vem preenchido em resposta 2xx com corpo JSON
   * válido (`get`); `file`, em resposta 2xx baixada por inteiro (`download`).
   */
  | {
      kind: 'RESPONSE';
      status: number;
      json?: unknown;
      file?: SourceDownloadedFile;
    }
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

  /**
   * `GET` de um arquivo grande, gravado em `destination`, com tempo máximo,
   * limite de tamanho e sem seguir redirecionamentos. Falhando no meio, não
   * deixa arquivo parcial.
   */
  abstract download(request: SourceDownloadRequest): Promise<SourceHttpResult>;
}

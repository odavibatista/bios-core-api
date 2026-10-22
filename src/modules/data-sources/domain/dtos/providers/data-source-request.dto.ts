import type { RequestOutcome, RequestTrigger } from '@prisma/client';

/** Origem da chamada, registrada no log de requisições. */
export interface SourceCallContext {
  /** O que motivou a chamada: consulta de usuário, API pública ou job. */
  trigger: RequestTrigger;

  /** Execução de ingestão (`IngestionRun`), quando a chamada ocorre dentro de um job. */
  ingestionRunId?: string;
}

/**
 * Chamada HTTP a uma fonte externa, descrita sem montar URL: o endereço base
 * vem do catálogo (`data_sources.base_url`), e o restante, daqui.
 */
export interface DataSourceRequest {
  /** Identificador estável da fonte no catálogo (ex.: `BRASIL_API`). */
  slug: string;

  /**
   * Segmentos do caminho depois da URL base. São codificados na montagem: um
   * valor como `../admin` não escapa do caminho da fonte.
   */
  segments: readonly string[];

  /** Parâmetros de consulta. */
  query?: Readonly<Record<string, string>>;

  /**
   * Cabeçalhos próprios da fonte (ex.: chave de API do Portal da
   * Transparência). Nunca vão ao log de requisições.
   */
  headers?: Readonly<Record<string, string>>;

  /** CNPJ consultado, para o log (auditoria e cobertura por fonte). */
  cnpj?: string;

  /**
   * Quando presente, a resposta é um arquivo grande (um dump em lote) gravado em
   * `destination`, e não um JSON: o `body` do sucesso é um `SourceDownloadedFile`.
   * Mesmo limite por minuto, tempo máximo e log das demais chamadas.
   */
  download?: { destination: string; maxBytes: number };

  /** Rota de um adapter para fontes com mais de um host oficial; nunca vem do usuario. */
  resolveBaseUrl?: (configuredBaseUrl: string) => string;

  /** Orcamento restante da coleta; so pode reduzir o timeout do catalogo. */
  budgetMs?: number;

  context: SourceCallContext;
}

/** Resultado de uma chamada a uma fonte, sem exceção para falhas esperadas. */
export type SourceResponse =
  /** A fonte respondeu 2xx com um JSON. */
  | { outcome: typeof SourceOutcome.SUCCESS; status: number; body: unknown }
  /** A fonte respondeu, sem registro para a consulta (HTTP 404). */
  | { outcome: typeof SourceOutcome.NOT_FOUND; status: number }
  /** A chamada não produziu dado: erro, tempo esgotado ou limite atingido. */
  | {
      outcome:
        | typeof SourceOutcome.FAILURE
        | typeof SourceOutcome.TIMEOUT
        | typeof SourceOutcome.RATE_LIMITED;
      status?: number;
      message: string;
    }
  /** A fonte está desabilitada no catálogo: nenhuma chamada foi feita. */
  | { outcome: typeof SourceOutcome.DISABLED };

/**
 * Resultados possíveis de uma chamada: os do log (`RequestOutcome`) mais
 * `DISABLED`, que não vira registro porque não houve chamada.
 */
export const SourceOutcome = {
  SUCCESS: 'SUCCESS',
  NOT_FOUND: 'NOT_FOUND',
  FAILURE: 'FAILURE',
  TIMEOUT: 'TIMEOUT',
  RATE_LIMITED: 'RATE_LIMITED',
  DISABLED: 'DISABLED',
} as const satisfies Record<RequestOutcome | 'DISABLED', string>;

export type SourceOutcome = (typeof SourceOutcome)[keyof typeof SourceOutcome];

/** Configuração de uma fonte que as chamadas respeitam (NFPD01). */
export interface DataSourceRequestConfig {
  id: string;
  slug: string;
  baseUrl: string;
  isEnabled: boolean;

  /** Teto de requisições por minuto; `null` quando a fonte não declara limite. */
  rateLimitPerMinute: number | null;

  /** Tempo máximo de uma chamada, em ms; `null` usa o padrão. */
  requestTimeoutMs: number | null;
}

/** Registro de uma chamada, para o log de requisições. */
export interface DataSourceRequestLogEntry {
  dataSourceId: string;
  ingestionRunId?: string;
  cnpj?: string;
  trigger: RequestTrigger;
  outcome: RequestOutcome;
  httpStatus?: number;
  durationMs: number;
  errorMessage?: string;
}

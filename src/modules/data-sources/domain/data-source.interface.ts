import {
  SourceOutcome,
  type SourceCallContext,
  type SourceResponse,
} from './dtos/providers/data-source-request.dto.js';

/** Por que uma fonte não entregou dado, para quem decide o próximo passo. */
export type SourceUnavailableReason =
  | typeof SourceOutcome.FAILURE
  | typeof SourceOutcome.TIMEOUT
  | typeof SourceOutcome.RATE_LIMITED
  | typeof SourceOutcome.DISABLED;

/**
 * Resposta de um adapter, já no vocabulário do domínio.
 *
 * Três situações que quem chama trata de modo diferente: a fonte respondeu com
 * dado (`FOUND`), respondeu que não há registro (`NOT_FOUND`, uma resposta
 * válida) ou não pôde responder (`UNAVAILABLE`, que na cadeia de fallback leva
 * à fonte seguinte e na ingestão leva a nova tentativa).
 */
export type SourceLookupResult<TData> =
  | { status: 'FOUND'; data: TData }
  | { status: 'NOT_FOUND' }
  | {
      status: 'UNAVAILABLE';
      reason: SourceUnavailableReason;
      message?: string;
    };

/**
 * Contrato de uma fonte externa (NFPD02).
 *
 * Cada fonte vive atrás de um adapter que o implementa: o restante do sistema
 * conhece o contrato, não o provedor. O adapter diz **o que** consultar e como
 * ler a resposta; limite de requisições, tempo máximo e log de cada chamada
 * ficam na infraestrutura comum (`RequestDataSourceUseCase`), que todos usam.
 *
 * `TQuery` é o que identifica a consulta (o CNPJ, um código CNAE...) e `TData`,
 * o que o adapter devolve já normalizado. Fontes que não se consultam item a
 * item (como o dump diário do IBAMA) definem o próprio fluxo de ingestão.
 */
export interface DataSourceInterface<TQuery, TData> {
  /** Identificador estável da fonte no catálogo (`data_sources.slug`). */
  readonly slug: string;

  fetch(
    query: TQuery,
    context: SourceCallContext,
  ): Promise<SourceLookupResult<TData>>;
}

/**
 * Traduz a resposta bruta da infraestrutura para o resultado do adapter.
 *
 * `parse` valida e converte o corpo de uma resposta 2xx; devolve `null` quando
 * ele não tem o formato combinado. Uma resposta fora do contrato é tratada
 * como fonte indisponível, e não como dado: aceitar um corpo qualquer
 * gravaria lixo no perfil da empresa.
 */
export function toLookupResult<TData>(
  response: SourceResponse,
  parse: (body: unknown) => TData | null,
): SourceLookupResult<TData> {
  switch (response.outcome) {
    case SourceOutcome.SUCCESS: {
      const data = parse(response.body);

      return data === null
        ? {
            status: 'UNAVAILABLE',
            reason: SourceOutcome.FAILURE,
            message: 'resposta fora do formato esperado',
          }
        : { status: 'FOUND', data };
    }
    case SourceOutcome.NOT_FOUND:
      return { status: 'NOT_FOUND' };
    case SourceOutcome.DISABLED:
      return { status: 'UNAVAILABLE', reason: SourceOutcome.DISABLED };
    default:
      return {
        status: 'UNAVAILABLE',
        reason: response.outcome,
        message: response.message,
      };
  }
}

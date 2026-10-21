import type { IbamaResource } from '../../ibama-resource.js';

/** Um dump que o adapter não conseguiu baixar, e o motivo. */
export interface IbamaDumpFailure {
  resource: IbamaResource;
  reason: string;
}

/**
 * Pelo menos um dos dumps do IBAMA não pôde ser baixado.
 *
 * É a falha que o job repete com *backoff* (UC14, fluxo 2.1): a fonte oficial
 * fora do ar costuma voltar. Como o lote só vale se os **dois** dumps vierem —
 * encerrar a carga com um recurso faltando apagaria evidências válidas dele —,
 * a mensagem traz o motivo de cada um que falhou.
 */
export class IbamaDumpUnavailableError extends Error {
  constructor(readonly failures: readonly IbamaDumpFailure[]) {
    super(
      `Dump do IBAMA indisponível — ${failures
        .map(({ resource, reason }) => `${resource}: ${reason}`)
        .join('; ')}`,
    );
    this.name = 'IbamaDumpUnavailableError';
  }
}

/**
 * A fonte do IBAMA está desabilitada no catálogo (`data_sources.is_enabled`).
 *
 * Desabilitar uma fonte é decisão operacional, não uma falha passageira:
 * repetir o job não a reabilita. Por isso a execução falha **sem repetição**, e
 * as evidências já gravadas seguem valendo até o fim da validade.
 */
export class IbamaSourceDisabledError extends Error {
  constructor() {
    super(
      'Fonte IBAMA desabilitada no catálogo (data_sources.is_enabled): ' +
        'o lote diário não foi executado.',
    );
    this.name = 'IbamaSourceDisabledError';
  }
}

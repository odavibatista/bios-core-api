import { Injectable } from '@nestjs/common';
import { UseCase } from '@shared/domain/protocols/use-case.protocol.js';
import { SCORES_REQUEST_CONCURRENCY } from '../../domain/ods-scoring-job.dto.js';
import { RequestScoreRecalculationUseCase } from './request-score-recalculation.usecase.js';

export interface ScoreRecalculationBatchResult {
  /** Pedidos publicados. */
  requested: number;

  /** Pedidos que a fila não aceitou (o recálculo dessas empresas fica para a próxima rodada). */
  degraded: number;
}

/**
 * Pede o recálculo de várias empresas de uma vez, em lotes (um job por CNPJ, #80): é o
 * que a ingestão do IBAMA faz com as empresas que ela alterou, e a varredura por versão
 * de regras, com as que ficaram para trás.
 *
 * Publica `SCORES_REQUEST_CONCURRENCY` pedidos por vez, para uma carga de dezenas de
 * milhares de empresas não abrir dezenas de milhares de comandos ao Redis de uma só vez.
 * CNPJ repetido na lista vale um pedido só.
 */
@Injectable()
export class RequestScoreRecalculationBatchUseCase extends UseCase<
  Iterable<string>,
  ScoreRecalculationBatchResult
> {
  constructor(private readonly request: RequestScoreRecalculationUseCase) {
    super();
  }

  override async execute(
    cnpjs: Iterable<string>,
  ): Promise<ScoreRecalculationBatchResult> {
    const unique = [...new Set(cnpjs)];
    const result: ScoreRecalculationBatchResult = { requested: 0, degraded: 0 };

    for (
      let from = 0;
      from < unique.length;
      from += SCORES_REQUEST_CONCURRENCY
    ) {
      const outcomes = await Promise.all(
        unique
          .slice(from, from + SCORES_REQUEST_CONCURRENCY)
          .map((cnpj) => this.request.execute({ cnpj })),
      );

      for (const outcome of outcomes) {
        if (outcome === 'DEGRADED') result.degraded += 1;
        else result.requested += 1;
      }
    }

    return result;
  }
}

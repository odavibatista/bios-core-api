import { Injectable, Logger } from '@nestjs/common';
import { UseCase } from '@shared/domain/protocols/use-case.protocol.js';
import { OdsScoreRepository } from '../../domain/dtos/repositories/ods-score.repository.js';
import { ODS_SCORE_RULES_VERSION } from '../../domain/ods-score-rules.js';
import {
  STALE_SCORES_PAGE_SIZE,
  type RecalculateStaleScoresJobResult,
} from '../../domain/ods-scoring-job.dto.js';
import { RequestScoreRecalculationBatchUseCase } from './request-score-recalculation-batch.usecase.js';

/**
 * Recálculo em lote depois de uma mudança das regras (#80): alterar
 * `ODS_SCORE_RULES_VERSION` deixa os índices gravados com a versão antiga, e esta
 * varredura reenfileira, página a página, todas as empresas nessa situação.
 *
 * Idempotente e retomável: lê por cursor de CNPJ e só pede o que ainda está na versão
 * antiga, de modo que repetir depois de uma falha não refaz o que já foi recalculado
 * (a empresa sai da lista assim que seu índice é regravado). Se algum pedido não foi
 * aceito pela fila, falha ao final para o BullMQ repetir a varredura.
 */
@Injectable()
export class RecalculateStaleScoresUseCase extends UseCase<
  void,
  RecalculateStaleScoresJobResult
> {
  private readonly logger = new Logger(RecalculateStaleScoresUseCase.name);

  constructor(
    private readonly scores: OdsScoreRepository,
    private readonly batch: RequestScoreRecalculationBatchUseCase,
  ) {
    super();
  }

  override async execute(): Promise<RecalculateStaleScoresJobResult> {
    let cursor: string | null = null;
    let requested = 0;
    let degraded = 0;

    for (;;) {
      const page: string[] = await this.scores.findCnpjsWithOtherRulesVersion(
        ODS_SCORE_RULES_VERSION,
        cursor,
        STALE_SCORES_PAGE_SIZE,
      );

      if (page.length === 0) break;

      const result = await this.batch.execute(page);

      requested += result.requested;
      degraded += result.degraded;
      cursor = page[page.length - 1];
    }

    if (requested > 0) {
      this.logger.log(
        `Regras ${ODS_SCORE_RULES_VERSION}: recálculo pedido para ${requested} empresa(s).`,
      );
    }

    if (degraded > 0) {
      throw new Error(
        `A fila não aceitou o recálculo de ${degraded} empresa(s); a varredura será repetida.`,
      );
    }

    return { requested };
  }
}

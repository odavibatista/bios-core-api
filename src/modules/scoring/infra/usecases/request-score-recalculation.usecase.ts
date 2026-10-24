import { Injectable, Logger } from '@nestjs/common';
import { QueueName } from '@shared/domain/dtos/providers/queue-job.dto.js';
import { QueueProvider } from '@shared/domain/providers/queue.provider.js';
import { UseCase } from '@shared/domain/protocols/use-case.protocol.js';
import { parseCnpj } from '@shared/domain/value-objects/cnpj.js';
import {
  RECALCULATE_SCORES_JOB,
  scoresJobId,
  type RecalculateScoresJobResult,
} from '../../domain/ods-scoring-job.dto.js';

export interface ScoreRecalculationRequest {
  /** CNPJ canônico. */
  cnpj: string;

  /** Aguarda o recálculo terminar (consulta sob demanda). Sem isso, só publica o pedido. */
  wait?: boolean;

  /** Prazo da espera, em milissegundos; ausente, vale `QUEUE_WAIT_TIMEOUT_MS`. */
  timeoutMs?: number;
}

/**
 * - `REQUESTED`: o pedido foi publicado (sem espera);
 * - `CALCULATED`: o recálculo terminou dentro do prazo;
 * - `DEGRADED`: a fila não aceitou o pedido, o prazo estourou ou o job falhou.
 */
export type ScoreRecalculationOutcome = 'REQUESTED' | 'CALCULATED' | 'DEGRADED';

/**
 * Gatilho do recálculo de índice e confiança de um CNPJ (UC15, #80).
 *
 * Publica o job `recalculate-scores` com coalescência exata pelo CNPJ: pedidos
 * simultâneos viram um só job enquanto ele não começou, e um pedido feito depois de o job
 * terminar, ou enquanto ele roda, gera um job novo (nunca devolve um resultado velho).
 *
 * **Nunca lança por causa da fila.** O índice é derivado das evidências e reproduzível:
 * quem pediu (a ingestão do IBAMA, a consulta do usuário, a atualização do perfil) já fez o
 * seu trabalho e não deve falhar porque o recálculo atrasou. Falha ou prazo vira
 * `DEGRADED` e um aviso (só o tipo do erro: nada de CNPJ nem de detalhe da fila no log).
 *
 * @throws {Error} apenas para CNPJ que não é canônico (erro de quem chama).
 */
@Injectable()
export class RequestScoreRecalculationUseCase extends UseCase<
  ScoreRecalculationRequest,
  ScoreRecalculationOutcome
> {
  private readonly logger = new Logger(RequestScoreRecalculationUseCase.name);

  constructor(private readonly queue: QueueProvider) {
    super();
  }

  override async execute({
    cnpj,
    wait = false,
    timeoutMs,
  }: ScoreRecalculationRequest): Promise<ScoreRecalculationOutcome> {
    if (parseCnpj(cnpj) !== cnpj) {
      throw new Error('Recálculo de índices pedido para um CNPJ não canônico.');
    }

    const options = { jobId: scoresJobId(cnpj), coalesce: true };

    try {
      if (wait) {
        await this.queue.enqueueAndWait<
          { cnpj: string },
          RecalculateScoresJobResult
        >(
          QueueName.ODS_SCORING,
          RECALCULATE_SCORES_JOB,
          { cnpj },
          { ...options, timeoutMs },
        );

        return 'CALCULATED';
      }

      await this.queue.enqueue(
        QueueName.ODS_SCORING,
        RECALCULATE_SCORES_JOB,
        { cnpj },
        options,
      );

      return 'REQUESTED';
    } catch (error) {
      this.logger.warn(
        `Recálculo de índices não concluído (${error instanceof Error ? error.name : typeof error}).`,
      );

      return 'DEGRADED';
    }
  }
}

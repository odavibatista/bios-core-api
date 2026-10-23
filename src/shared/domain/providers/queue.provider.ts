import type {
  EnqueueAndWaitOptions,
  EnqueueOptions,
  QueueName,
  QueueSchedule,
} from '../dtos/providers/queue-job.dto.js';

/**
 * Contrato de produção de jobs nas filas do sistema (NFCO01, NFPD02).
 *
 * Só o lado produtor: os consumidores vivem nos módulos donos de cada fluxo, que
 * processam cada fila sem conhecer quem publicou. O core publica e, quando a
 * resposta é imediata, aguarda a conclusão com prazo.
 *
 * Classe abstrata (e não interface) para servir também como token de injeção.
 */
export abstract class QueueProvider {
  /**
   * Publica um job sem aguardar o processamento.
   *
   * Não devolve identificador: quando a identidade do job importa — para não
   * enfileirar o mesmo CNPJ duas vezes, por exemplo —, quem publica já a
   * conhece e a informa em `options.jobId`.
   */
  abstract enqueue<P>(
    queue: QueueName,
    jobName: string,
    payload: P,
    options?: EnqueueOptions,
  ): Promise<void>;

  /**
   * Publica um job e aguarda sua conclusão, devolvendo o resultado do
   * consumidor.
   *
   * O prazo é o que sustenta a degradação graciosa (NFCO01): o chamador decide
   * o que fazer quando uma fonte não bloqueante não responde a tempo — por
   * exemplo, exibir a evidência do GHG como `UNKNOWN` em vez de falhar a
   * consulta inteira.
   *
   * @throws {QueueTimeoutException} quando o prazo termina antes da conclusão.
   * @throws {QueueJobFailedException} quando o job esgota as tentativas e falha.
   */
  abstract enqueueAndWait<P, R>(
    queue: QueueName,
    jobName: string,
    payload: P,
    options?: EnqueueAndWaitOptions,
  ): Promise<R>;

  /**
   * Registra um job repetível. É idempotente pelo `id` do agendamento:
   * registrar o mesmo agendamento novamente o atualiza, nunca o duplica.
   */
  abstract schedule(schedule: QueueSchedule): Promise<void>;

  /** Remove um agendamento (idempotente: ausente, não faz nada). */
  abstract unschedule(queue: QueueName, id: string): Promise<void>;
}

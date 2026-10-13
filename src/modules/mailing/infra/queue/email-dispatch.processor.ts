import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { QueueName } from '@shared/domain/dtos/providers/queue-job.dto.js';
import type { EmailDispatchJob } from '../../domain/dtos/providers/mail-message.dto.js';
import { EmailDispatchLogRepository } from '../../domain/dtos/repositories/email-dispatch-log.repository.js';
import { MailProvider } from '../../domain/providers/mail.provider.js';

/**
 * Última tentativa do job.
 *
 * Espelha a condição de reenvio do próprio BullMQ, que só reenfileira enquanto
 * `attemptsMade + 1 < attempts` — dentro do processador, `attemptsMade` conta as
 * tentativas já falhas.
 */
function isLastAttempt({ attemptsMade, opts }: Job): boolean {
  return attemptsMade + 1 >= (opts.attempts ?? 1);
}

/**
 * Envia os e-mails transacionais enfileirados e registra o desfecho (RF18).
 *
 * É o único consumidor hospedado nesta API: os demais fluxos assíncronos são
 * processados pelos serviços de ingestão. A fila dá o reenvio com backoff; aqui
 * só se decide **quando** a auditoria vira falha — na última tentativa, para
 * que um `FAILED` não apareça enquanto ainda há reenvio por vir.
 *
 * O erro é sempre propagado: é o que informa o BullMQ de que a tentativa falhou.
 */
@Processor(QueueName.EMAIL_DISPATCH)
export class EmailDispatchProcessor extends WorkerHost {
  private readonly logger = new Logger(EmailDispatchProcessor.name);

  constructor(
    private readonly mailProvider: MailProvider,
    private readonly emailDispatchLogRepository: EmailDispatchLogRepository,
  ) {
    super();
  }

  async process(job: Job<EmailDispatchJob>): Promise<void> {
    const { dispatchLogId, to, subject, html, text } = job.data;

    try {
      await this.mailProvider.send({ to, subject, html, text });
      await this.emailDispatchLogRepository.markSent(dispatchLogId);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);

      if (isLastAttempt(job)) {
        // Destinatário fora do log: ele existe apenas na carga do job (INL02).
        this.logger.error(
          `Disparo ${dispatchLogId} falhou em definitivo: ${reason}`,
        );
        await this.emailDispatchLogRepository.markFailed(dispatchLogId, reason);
      } else {
        this.logger.warn(
          `Disparo ${dispatchLogId} falhou (tentativa ${job.attemptsMade + 1}): ${reason}`,
        );
      }

      throw error;
    }
  }
}

import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { QueueName } from '@shared/domain/dtos/providers/queue-job.dto.js';
import { UseCase } from '@shared/domain/protocols/use-case.protocol.js';
import { EncryptionProvider } from '@shared/domain/providers/encryption.provider.js';
import { QueueProvider } from '@shared/domain/providers/queue.provider.js';
import type {
  EmailDispatchJob,
  MailDispatchRequest,
} from '../../domain/dtos/providers/mail-message.dto.js';
import { EmailDispatchLogRepository } from '../../domain/dtos/repositories/email-dispatch-log.repository.js';

/** Nome do job de envio, único na fila de e-mails. */
export const SEND_EMAIL_JOB = 'send-email';

/**
 * Registra e enfileira um e-mail transacional (RF18).
 *
 * **Só enfileira.** O envio acontece no processor, de modo que uma falha de
 * SMTP não interrompe o fluxo que originou o e-mail: o cadastro conclui, o
 * login conclui, a recuperação de senha conclui — e o e-mail é reenviado pela
 * fila por conta própria.
 *
 * O identificador do job é sorteado aqui, antes de publicar, para que o
 * registro de auditoria já nasça apontando para ele. É também a chave de
 * deduplicação da fila: republicar o mesmo job não gera dois envios.
 *
 * Devolve o identificador do registro de auditoria, útil para quem quiser
 * acompanhar o disparo.
 */
@Injectable()
export class DispatchEmailUseCase extends UseCase<MailDispatchRequest, string> {
  constructor(
    private readonly emailDispatchLogRepository: EmailDispatchLogRepository,
    private readonly encryptionProvider: EncryptionProvider,
    private readonly queueProvider: QueueProvider,
  ) {
    super();
  }

  override async execute({
    template,
    to,
    subject,
    html,
    text,
    userId,
  }: MailDispatchRequest): Promise<string> {
    const jobId = randomUUID();
    const dispatchLogId = await this.emailDispatchLogRepository.create({
      template,
      recipientEmailHash: this.encryptionProvider.blindIndex(to),
      jobId,
      userId,
    });

    const job: EmailDispatchJob = { dispatchLogId, to, subject, html, text };
    await this.queueProvider.enqueue(
      QueueName.EMAIL_DISPATCH,
      SEND_EMAIL_JOB,
      job,
      { jobId },
    );

    return dispatchLogId;
  }
}

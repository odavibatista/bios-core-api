import type { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { EmailDispatchStatus } from '@prisma/client';
import { MailingModule } from '@modules/mailing/infra/modules/mailing.module.js';
import { MailProvider } from '@modules/mailing/domain/providers/mail.provider.js';
import { DispatchEmailUseCase } from '@modules/mailing/infra/usecases/dispatch-email.usecase.js';
import { validateEnvironment } from '@shared/config/environment.config.js';
import { DatabaseModule } from '@shared/infra/database/database.module.js';
import { PrismaService } from '@shared/infra/database/prisma.service.js';
import { EncryptionModule } from '@shared/infra/modules/encryption.module.js';
import { QueueModule } from '@shared/infra/modules/queue.module.js';
import { Queue } from 'bullmq';
import { QueueName } from '@shared/domain/dtos/providers/queue-job.dto.js';
import { inject } from 'vitest';
import { mailDispatchRequestFactory } from '../factories/mailing/email-dispatch.factory.js';
import { buildTestEnvironment } from '../support/environment.js';

const REDIS_URL = inject('testRedisUrl');

/**
 * Transporte dublê no lugar do SMTP: registra o que foi "enviado" e permite
 * simular falha. Nenhuma suíte abre conexão com servidor de e-mail.
 */
class RecordingMailProvider extends MailProvider {
  readonly sent: { to: string; subject: string }[] = [];
  attempts = 0;
  failure?: Error;

  override send(message: {
    to: string;
    subject: string;
    html: string;
  }): Promise<void> {
    this.attempts += 1;

    if (this.failure) return Promise.reject(this.failure);

    this.sent.push({ to: message.to, subject: message.subject });

    return Promise.resolve();
  }
}

/**
 * Ciclo completo de um e-mail transacional contra fila e banco reais: o caso de
 * uso registra e enfileira, e o processor hospedado nesta API envia e fecha a
 * auditoria. Só o SMTP é substituído.
 */
describe.runIf(inject('databaseAvailable') && inject('redisAvailable'))(
  'E-mails transacionais com fila e banco reais (e2e)',
  () => {
    const mailProvider = new RecordingMailProvider();
    let app: INestApplication;
    let prisma: PrismaService;
    let dispatchEmail: DispatchEmailUseCase;

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [
          ConfigModule.forRoot({
            isGlobal: true,
            ignoreEnvFile: true,
            load: [
              () => validateEnvironment(buildTestEnvironment({ REDIS_URL })),
            ],
          }),
          DatabaseModule,
          EncryptionModule,
          QueueModule,
          MailingModule,
        ],
      })
        .overrideProvider(MailProvider)
        .useValue(mailProvider)
        .compile();

      app = moduleRef.createNestApplication();
      await app.init();

      prisma = app.get(PrismaService);
      dispatchEmail = app.get(DispatchEmailUseCase);
    });

    afterEach(async () => {
      mailProvider.failure = undefined;
      mailProvider.attempts = 0;
      mailProvider.sent.length = 0;
      await prisma.reset(['email_dispatch_logs']);
    });

    afterAll(async () => {
      const queue = new Queue(QueueName.EMAIL_DISPATCH, {
        connection: { url: REDIS_URL },
      });
      await queue.obliterate({ force: true });
      await queue.close();
      await app.close();
    });

    /** Aguarda o registro alcançar uma situação definitiva. */
    function waitForStatus(
      id: string,
      status: EmailDispatchStatus,
    ): Promise<void> {
      return vi.waitFor(
        async () => {
          const log = await prisma.emailDispatchLog.findUniqueOrThrow({
            where: { id_email_dispatch_log: id },
          });

          expect(log.status).toBe(status);
        },
        { timeout: 10_000, interval: 100 },
      );
    }

    it('envia o e-mail enfileirado e fecha a auditoria como enviado', async () => {
      const request = mailDispatchRequestFactory.build();

      const dispatchLogId = await dispatchEmail.execute(request);

      await waitForStatus(dispatchLogId, EmailDispatchStatus.SENT);

      const log = await prisma.emailDispatchLog.findUniqueOrThrow({
        where: { id_email_dispatch_log: dispatchLogId },
      });
      expect(log.sent_at).toBeInstanceOf(Date);
      expect(log.job_id).toEqual(expect.any(String));
      expect(mailProvider.sent).toEqual([
        { to: request.to, subject: request.subject },
      ]);
    });

    it('não guarda o e-mail do destinatário em claro, só o hash', async () => {
      const request = mailDispatchRequestFactory.build();

      const dispatchLogId = await dispatchEmail.execute(request);
      await waitForStatus(dispatchLogId, EmailDispatchStatus.SENT);

      const log = await prisma.emailDispatchLog.findUniqueOrThrow({
        where: { id_email_dispatch_log: dispatchLogId },
      });
      expect(JSON.stringify(log)).not.toContain(request.to);
      expect(log.recipient_email_hash).not.toBe(request.to);
      expect(log.recipient_email_hash.length).toBeGreaterThan(0);
    });

    it('mantém o disparo enfileirado enquanto resta reenvio', async () => {
      mailProvider.failure = new Error('servidor de e-mail recusou a conexão');

      const dispatchLogId = await dispatchEmail.execute(
        mailDispatchRequestFactory.build(),
      );
      await vi.waitFor(() => expect(mailProvider.attempts).toBe(1), {
        timeout: 10_000,
        interval: 100,
      });

      // A política da fila prevê 5 tentativas com backoff de 30s: esgotá-las
      // levaria minutos, e o que importa aqui é que a auditoria **não** vira
      // falha na primeira — a decisão da última tentativa é verificada em
      // `email-dispatch.processor.spec.ts`.
      const log = await prisma.emailDispatchLog.findUniqueOrThrow({
        where: { id_email_dispatch_log: dispatchLogId },
      });
      expect(log.status).toBe(EmailDispatchStatus.QUEUED);
      expect(log.failure_reason).toBeNull();
      expect(log.sent_at).toBeNull();
    });
  },
);

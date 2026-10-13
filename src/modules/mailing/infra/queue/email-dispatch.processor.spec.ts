import { Test } from '@nestjs/testing';
import type { Job } from 'bullmq';
import {
  emailDispatchJobFactory,
  buildObjectId,
} from '@test/factories/mailing/email-dispatch.factory.js';
import { faker } from '@test/support/faker.js';
import type { EmailDispatchJob } from '../../domain/dtos/providers/mail-message.dto.js';
import { EmailDispatchLogRepository } from '../../domain/dtos/repositories/email-dispatch-log.repository.js';
import { MailProvider } from '../../domain/providers/mail.provider.js';
import { EmailDispatchProcessor } from './email-dispatch.processor.js';

/** Total de tentativas da fila de e-mails (ver queue.config.ts). */
const ATTEMPTS = 5;

/**
 * Job no formato que o processador recebe. `attemptsMade` conta as tentativas
 * já falhas, como no BullMQ.
 */
function buildJob(
  attemptsMade: number,
  data: EmailDispatchJob = emailDispatchJobFactory.build(),
): Job<EmailDispatchJob> {
  return {
    data,
    attemptsMade,
    opts: { attempts: ATTEMPTS },
  } as unknown as Job<EmailDispatchJob>;
}

describe('EmailDispatchProcessor', () => {
  const mailProvider = { send: vi.fn<() => Promise<void>>() };
  const emailDispatchLogRepository = {
    create: vi.fn(),
    markSent: vi.fn<() => Promise<void>>(),
    markFailed: vi.fn<() => Promise<void>>(),
  };
  let processor: EmailDispatchProcessor;

  beforeEach(async () => {
    mailProvider.send.mockResolvedValue();
    emailDispatchLogRepository.markSent.mockResolvedValue();
    emailDispatchLogRepository.markFailed.mockResolvedValue();

    const moduleRef = await Test.createTestingModule({
      providers: [
        EmailDispatchProcessor,
        { provide: MailProvider, useValue: mailProvider },
        {
          provide: EmailDispatchLogRepository,
          useValue: emailDispatchLogRepository,
        },
      ],
    }).compile();

    processor = moduleRef.get(EmailDispatchProcessor);
  });

  describe('envio concluído', () => {
    it('entrega a mensagem e marca a auditoria como enviada', async () => {
      const data = emailDispatchJobFactory.build({
        dispatchLogId: buildObjectId(),
      });

      await processor.process(buildJob(0, data));

      expect(mailProvider.send).toHaveBeenCalledWith({
        to: data.to,
        subject: data.subject,
        html: data.html,
      });
      expect(emailDispatchLogRepository.markSent).toHaveBeenCalledWith(
        data.dispatchLogId,
      );
      expect(emailDispatchLogRepository.markFailed).not.toHaveBeenCalled();
    });
  });

  describe('envio falho', () => {
    it('propaga o erro para a fila reenviar', async () => {
      const failure = new Error(faker.lorem.sentence());
      mailProvider.send.mockRejectedValue(failure);

      await expect(processor.process(buildJob(0))).rejects.toBe(failure);
    });

    it.each([0, 1, ATTEMPTS - 2])(
      'não marca falha enquanto resta reenvio (tentativas feitas: %i)',
      async (attemptsMade) => {
        mailProvider.send.mockRejectedValue(new Error(faker.lorem.sentence()));

        await expect(
          processor.process(buildJob(attemptsMade)),
        ).rejects.toThrow();

        // Um FAILED aqui mentiria: o e-mail ainda pode sair.
        expect(emailDispatchLogRepository.markFailed).not.toHaveBeenCalled();
      },
    );

    it('marca falha com o motivo na última tentativa', async () => {
      const reason = faker.lorem.sentence();
      mailProvider.send.mockRejectedValue(new Error(reason));
      const data = emailDispatchJobFactory.build();

      await expect(
        processor.process(buildJob(ATTEMPTS - 1, data)),
      ).rejects.toThrow();

      expect(emailDispatchLogRepository.markFailed).toHaveBeenCalledWith(
        data.dispatchLogId,
        reason,
      );
    });

    it('registra falha de valor lançado que não é Error', async () => {
      mailProvider.send.mockRejectedValue('conexão recusada');
      const data = emailDispatchJobFactory.build();

      await expect(
        processor.process(buildJob(ATTEMPTS - 1, data)),
      ).rejects.toBe('conexão recusada');

      expect(emailDispatchLogRepository.markFailed).toHaveBeenCalledWith(
        data.dispatchLogId,
        'conexão recusada',
      );
    });

    it('trata job sem total de tentativas declarado como tentativa única', async () => {
      mailProvider.send.mockRejectedValue(new Error(faker.lorem.sentence()));
      const job = { ...buildJob(0), opts: {} } as Job<EmailDispatchJob>;

      await expect(processor.process(job)).rejects.toThrow();

      expect(emailDispatchLogRepository.markFailed).toHaveBeenCalled();
    });
  });
});

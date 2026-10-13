import { Test } from '@nestjs/testing';
import { QueueName } from '@shared/domain/dtos/providers/queue-job.dto.js';
import { EncryptionProvider } from '@shared/domain/providers/encryption.provider.js';
import { QueueProvider } from '@shared/domain/providers/queue.provider.js';
import {
  buildObjectId,
  mailDispatchRequestFactory,
} from '@test/factories/mailing/email-dispatch.factory.js';
import { faker } from '@test/support/faker.js';
import { EmailDispatchLogRepository } from '../../domain/dtos/repositories/email-dispatch-log.repository.js';
import {
  DispatchEmailUseCase,
  SEND_EMAIL_JOB,
} from './dispatch-email.usecase.js';

describe('DispatchEmailUseCase', () => {
  const emailDispatchLogRepository = {
    create: vi.fn<EmailDispatchLogRepository['create']>(),
    markSent: vi.fn(),
    markFailed: vi.fn(),
  };
  const encryptionProvider = { blindIndex: vi.fn<() => string>() };
  const queueProvider = { enqueue: vi.fn<QueueProvider['enqueue']>() };
  let useCase: DispatchEmailUseCase;

  beforeEach(async () => {
    emailDispatchLogRepository.create.mockResolvedValue(buildObjectId());
    encryptionProvider.blindIndex.mockReturnValue(
      faker.string.alphanumeric({ length: 43 }),
    );
    queueProvider.enqueue.mockResolvedValue();

    const moduleRef = await Test.createTestingModule({
      providers: [
        DispatchEmailUseCase,
        {
          provide: EmailDispatchLogRepository,
          useValue: emailDispatchLogRepository,
        },
        { provide: EncryptionProvider, useValue: encryptionProvider },
        { provide: QueueProvider, useValue: queueProvider },
      ],
    }).compile();

    useCase = moduleRef.get(DispatchEmailUseCase);
  });

  it('registra a auditoria como enfileirada e publica o envio', async () => {
    const dispatchLogId = buildObjectId();
    emailDispatchLogRepository.create.mockResolvedValue(dispatchLogId);
    const request = mailDispatchRequestFactory.build();

    await expect(useCase.execute(request)).resolves.toBe(dispatchLogId);

    expect(queueProvider.enqueue).toHaveBeenCalledWith(
      QueueName.EMAIL_DISPATCH,
      SEND_EMAIL_JOB,
      {
        dispatchLogId,
        to: request.to,
        subject: request.subject,
        html: request.html,
        text: request.text,
      },
      { jobId: expect.any(String) },
    );
  });

  it('guarda o hash do destinatário, nunca o e-mail em claro', async () => {
    const request = mailDispatchRequestFactory.build();
    const hash = faker.string.alphanumeric({ length: 43 });
    encryptionProvider.blindIndex.mockReturnValue(hash);

    await useCase.execute(request);

    expect(encryptionProvider.blindIndex).toHaveBeenCalledWith(request.to);
    expect(emailDispatchLogRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        template: request.template,
        recipientEmailHash: hash,
      }),
    );
    const [log] = emailDispatchLogRepository.create.mock.calls[0];
    expect(JSON.stringify(log)).not.toContain(request.to);
  });

  it('aponta a auditoria para o job que vai enviar', async () => {
    await useCase.execute(mailDispatchRequestFactory.build());

    const [log] = emailDispatchLogRepository.create.mock.calls[0];
    const [, , , options] = queueProvider.enqueue.mock.calls[0];

    expect(options?.jobId).toBe(log.jobId);
  });

  it('vincula ao usuário quando o e-mail pertence a uma conta', async () => {
    const userId = buildObjectId();

    await useCase.execute(mailDispatchRequestFactory.build({ userId }));

    expect(emailDispatchLogRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ userId }),
    );
  });

  it('não envia nada por conta própria: o envio é do processor', async () => {
    await useCase.execute(mailDispatchRequestFactory.build());

    expect(emailDispatchLogRepository.markSent).not.toHaveBeenCalled();
    expect(emailDispatchLogRepository.markFailed).not.toHaveBeenCalled();
  });
});

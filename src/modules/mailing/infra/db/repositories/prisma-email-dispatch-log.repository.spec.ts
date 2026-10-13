import { Test } from '@nestjs/testing';
import { EmailDispatchStatus, EmailTemplate } from '@prisma/client';
import { PrismaService } from '@shared/infra/database/prisma.service.js';
import {
  buildObjectId,
  emailDispatchLogFactory,
} from '@test/factories/mailing/email-dispatch.factory.js';
import { faker } from '@test/support/faker.js';
import { PrismaEmailDispatchLogRepository } from './prisma-email-dispatch-log.repository.js';

describe('PrismaEmailDispatchLogRepository', () => {
  const emailDispatchLog = {
    create: vi.fn<() => Promise<{ id_email_dispatch_log: string }>>(),
    update: vi.fn<() => Promise<unknown>>(),
  };
  let repository: PrismaEmailDispatchLogRepository;

  beforeEach(async () => {
    emailDispatchLog.create.mockResolvedValue(emailDispatchLogFactory.build());
    emailDispatchLog.update.mockResolvedValue({});

    const moduleRef = await Test.createTestingModule({
      providers: [
        PrismaEmailDispatchLogRepository,
        { provide: PrismaService, useValue: { emailDispatchLog } },
      ],
    }).compile();

    repository = moduleRef.get(PrismaEmailDispatchLogRepository);
  });

  it('cria o registro como enfileirado e devolve o identificador', async () => {
    const log = emailDispatchLogFactory.build();
    emailDispatchLog.create.mockResolvedValue(log);
    const input = {
      template: EmailTemplate.EMAIL_CONFIRMATION,
      recipientEmailHash: faker.string.alphanumeric({ length: 43 }),
      jobId: faker.string.uuid(),
      userId: buildObjectId(),
    };

    await expect(repository.create(input)).resolves.toBe(
      log.id_email_dispatch_log,
    );
    expect(emailDispatchLog.create).toHaveBeenCalledWith({
      data: {
        template: input.template,
        recipient_email_hash: input.recipientEmailHash,
        job_id: input.jobId,
        user_id: input.userId,
        status: EmailDispatchStatus.QUEUED,
      },
      select: { id_email_dispatch_log: true },
    });
  });

  it('marca como enviado com a data do envio', async () => {
    const id = buildObjectId();

    await repository.markSent(id);

    expect(emailDispatchLog.update).toHaveBeenCalledWith({
      where: { id_email_dispatch_log: id },
      data: { status: EmailDispatchStatus.SENT, sent_at: expect.any(Date) },
    });
  });

  it('marca como falho com o motivo', async () => {
    const id = buildObjectId();
    const reason = faker.lorem.sentence();

    await repository.markFailed(id, reason);

    expect(emailDispatchLog.update).toHaveBeenCalledWith({
      where: { id_email_dispatch_log: id },
      data: {
        status: EmailDispatchStatus.FAILED,
        failure_reason: reason,
      },
    });
  });
});

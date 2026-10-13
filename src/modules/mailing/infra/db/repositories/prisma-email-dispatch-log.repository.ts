import { Injectable } from '@nestjs/common';
import { EmailDispatchStatus } from '@prisma/client';
import { PrismaRepository } from '@shared/infra/database/prisma.repository.js';
import { PrismaService } from '@shared/infra/database/prisma.service.js';
import {
  EmailDispatchLogRepository,
  type NewEmailDispatchLog,
} from '../../../domain/dtos/repositories/email-dispatch-log.repository.js';

/**
 * Auditoria dos disparos de e-mail no MongoDB.
 */
@Injectable()
export class PrismaEmailDispatchLogRepository
  extends PrismaRepository
  implements EmailDispatchLogRepository
{
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  async create({
    template,
    recipientEmailHash,
    jobId,
    userId,
  }: NewEmailDispatchLog): Promise<string> {
    const { id_email_dispatch_log } = await this.prisma.emailDispatchLog.create(
      {
        data: {
          template,
          recipient_email_hash: recipientEmailHash,
          job_id: jobId,
          user_id: userId,
          status: EmailDispatchStatus.QUEUED,
        },
        select: { id_email_dispatch_log: true },
      },
    );

    return id_email_dispatch_log;
  }

  async markSent(id: string): Promise<void> {
    await this.prisma.emailDispatchLog.update({
      where: { id_email_dispatch_log: id },
      data: { status: EmailDispatchStatus.SENT, sent_at: new Date() },
    });
  }

  async markFailed(id: string, reason: string): Promise<void> {
    await this.prisma.emailDispatchLog.update({
      where: { id_email_dispatch_log: id },
      data: { status: EmailDispatchStatus.FAILED, failure_reason: reason },
    });
  }
}

import { EmailDispatchStatus, EmailTemplate } from '@prisma/client';
import type {
  EmailDispatchJob,
  MailDispatchRequest,
} from '@modules/mailing/domain/dtos/providers/mail-message.dto.js';
import { faker } from '../../support/faker.js';
import { defineFactory, timestamps } from '../factory.js';

/** Identificador no formato dos ObjectId do MongoDB. */
export function buildObjectId(): string {
  return faker.database.mongodbObjectId();
}

/** Pedido de disparo com conteúdo já pronto. */
export const mailDispatchRequestFactory = defineFactory<MailDispatchRequest>(
  () => ({
    template: faker.helpers.objectValue(EmailTemplate),
    to: faker.internet.email(),
    subject: faker.lorem.sentence(),
    html: `<p>${faker.lorem.paragraph()}</p>`,
  }),
);

/** Carga do job de envio. */
export const emailDispatchJobFactory = defineFactory<EmailDispatchJob>(() => ({
  dispatchLogId: buildObjectId(),
  to: faker.internet.email(),
  subject: faker.lorem.sentence(),
  html: `<p>${faker.lorem.paragraph()}</p>`,
}));

/** Registro de auditoria, no formato devolvido pelo banco. */
export const emailDispatchLogFactory = defineFactory(() => ({
  id_email_dispatch_log: buildObjectId(),
  user_id: null,
  template: faker.helpers.objectValue(EmailTemplate),
  recipient_email_hash: faker.string.alphanumeric({ length: 43 }),
  status: EmailDispatchStatus.QUEUED,
  job_id: faker.string.uuid(),
  failure_reason: null,
  sent_at: null,
  ...timestamps(),
}));

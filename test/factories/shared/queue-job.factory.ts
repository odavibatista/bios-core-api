import {
  QueueName,
  type QueueSchedule,
} from '@shared/domain/dtos/providers/queue-job.dto.js';
import { faker } from '../../support/faker.js';
import { defineFactory } from '../factory.js';

/** Nome de job, no padrão verbo-recurso usado pelos consumidores. */
export function buildJobName(): string {
  return `${faker.hacker.verb()}-${faker.lorem.slug(1)}`;
}

/** Identificador de job atribuído pelo BullMQ. */
export function buildJobId(): string {
  return String(faker.number.int({ min: 1, max: 99_999 }));
}

/** Carga de um job: um CNPJ, como nos fluxos de ingestão. */
export function buildJobPayload(): { cnpj: string } {
  return { cnpj: faker.string.numeric({ length: 14 }) };
}

/** Agendamento de job repetível. */
export const queueScheduleFactory = defineFactory<QueueSchedule>(() => ({
  queue: faker.helpers.objectValue(QueueName),
  id: faker.lorem.slug(2),
  jobName: buildJobName(),
  cron: `${faker.number.int({ min: 0, max: 59 })} ${faker.number.int({
    min: 0,
    max: 23,
  })} * * *`,
}));

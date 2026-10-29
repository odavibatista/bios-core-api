import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import { AppModule } from '@app/app.module.js';
import { QueueName } from '@shared/domain/dtos/providers/queue-job.dto.js';
import { PrismaService } from '@shared/infra/database/prisma.service.js';
import {
  QUEUE_REGISTRY,
  type QueueRegistry,
} from '@shared/infra/providers/bullmq-queue.provider.js';

export interface DatabaseTestingApp {
  app: INestApplication;
  prisma: PrismaService;
}

/**
 * Sobe o `AppModule` completo conectado ao banco descartável de testes do
 * worker (DATABASE_URL definida em test/setup/worker-infrastructure.setup.ts).
 *
 * Nenhum provider é substituído por padrão. `configure` permite trocar apenas
 * o que sai do processo — ex.: o transporte de e-mail por um dublê que
 * registra as mensagens —, mantendo banco, fila e pipeline HTTP reais.
 */
export async function createDatabaseTestingApp(
  configure?: (builder: TestingModuleBuilder) => void,
): Promise<DatabaseTestingApp> {
  const builder = Test.createTestingModule({ imports: [AppModule] });
  configure?.(builder);

  const app = (await builder.compile()).createNestApplication();
  await app.init();
  // O supertest sobe o servidor a cada requisição enquanto ele não está ouvindo, e
  // as requisições simultâneas se enfileiram em `once('listening' | 'error' |
  // 'close')` do mesmo servidor: com 11 ou mais, o Node avisa de vazamento de
  // ouvintes (#259). Ouvindo desde já, em porta livre, cada requisição vai direto.
  await app.listen(0);
  drainScoringQueueBeforeClose(app);

  return { app, prisma: app.get(PrismaService) };
}

/**
 * Antes de fechar a aplicação, espera a fila de scoring esvaziar (#80).
 *
 * Vários fluxos pedem o recálculo dos índices ao terminar; se o app fechasse com um job
 * em andamento, o banco se desconectaria no meio da transação, que continuaria aberta no
 * servidor, e o próximo `delete` do teste esperaria por ela (hooks de 30 s no CI). O
 * Nest fecha o módulo compartilhado antes do consumidor, então a ordem não basta.
 */
function drainScoringQueueBeforeClose(app: INestApplication): void {
  const close = app.close.bind(app);

  app.close = async (): Promise<void> => {
    await waitForScoringQueue(app);

    return close();
  };
}

/**
 * Espera a fila de scoring esvaziar (até 10 s).
 *
 * Quem limpa `company_ods_scores` ao terminar precisa chamar isto **antes** da limpeza: um
 * recálculo ainda na fila gravaria o índice depois dela, e o arquivo seguinte do mesmo
 * worker (que divide o banco) encontraria um índice que não criou.
 */
export function waitForScoringQueue(app: INestApplication): Promise<void> {
  return waitForQueue(app, QueueName.ODS_SCORING);
}

/**
 * Espera a fila de e-mails esvaziar (até 10 s).
 *
 * Quem limpa o dublê do transporte e `email_dispatch_logs` entre os testes precisa chamar
 * isto **antes** da limpeza: um aviso ainda na fila seria entregue durante o teste
 * seguinte, que o encontraria no dublê, e o registro do envio, já apagado, faria a
 * tentativa falhar e o BullMQ reenviar o mesmo e-mail mais tarde.
 */
export function waitForEmailQueue(app: INestApplication): Promise<void> {
  return waitForQueue(app, QueueName.EMAIL_DISPATCH);
}

/** Espera a fila `name` ficar sem jobs pendentes, em andamento ou adiados (até 10 s). */
async function waitForQueue(
  app: INestApplication,
  name: QueueName,
): Promise<void> {
  const queue = app.get<QueueRegistry>(QUEUE_REGISTRY).get(name);
  const deadline = Date.now() + 10_000;

  while (queue && Date.now() < deadline) {
    const { waiting, active, delayed } = await queue.getJobCounts(
      'waiting',
      'active',
      'delayed',
    );
    if (waiting + active + delayed === 0) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

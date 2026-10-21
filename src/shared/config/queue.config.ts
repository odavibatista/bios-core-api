import type { ConfigService } from '@nestjs/config';
import type { DefaultJobOptions, RedisOptions } from 'bullmq';
import {
  QueueName,
  type QueueRetryPolicy,
  type QueueSchedule,
} from '../domain/dtos/providers/queue-job.dto.js';
import type { Environment } from './environment.config.js';

/**
 * Política de repetição de cada fila.
 *
 * As filas que atendem a uma consulta do usuário erram rápido: insistir não
 * ajuda quem está esperando a resposta. As que rodam em segundo plano
 * (ingestão, recálculo, e-mail) insistem mais e com intervalos maiores, porque
 * a indisponibilidade típica das fontes oficiais é temporária.
 */
export const QUEUE_RETRY_POLICIES: Readonly<
  Record<QueueName, QueueRetryPolicy>
> = {
  [QueueName.COMPANY_PROFILE]: { attempts: 3, backoffMs: 1_000 },
  [QueueName.ENVIRONMENTAL_EVIDENCES]: { attempts: 5, backoffMs: 5_000 },
  [QueueName.GHG_INVENTORY]: { attempts: 3, backoffMs: 5_000 },
  [QueueName.ODS_SCORING]: { attempts: 3, backoffMs: 1_000 },
  [QueueName.EMAIL_DISPATCH]: { attempts: 5, backoffMs: 30_000 },
};

/**
 * Jobs repetíveis registrados na inicialização.
 *
 * O lote diário do IBAMA é disparado pelo core e consumido pelo serviço de
 * ingestão ambiental (`08-Artefatos-de-Análise.md`, diagrama 4). O horário
 * evita o pico de acesso aos Dados Abertos no começo do dia útil.
 */
export const QUEUE_SCHEDULES: readonly QueueSchedule[] = [
  {
    queue: QueueName.ENVIRONMENTAL_EVIDENCES,
    id: 'ibama-daily-ingestion',
    jobName: 'ingest-ibama-dumps',
    cron: '0 4 * * *',
    // O backoff do lote é de minutos (5, 10, 20 e 40 min entre as cinco
    // tentativas): uma fonte oficial fora do ar costuma ficar horas, e repetir
    // a cada segundos só gastaria tentativas — e dois downloads de centenas de
    // MB — antes de ela voltar. Os jobs por CNPJ da mesma fila mantêm a política
    // curta da fila.
    retry: { attempts: 5, backoffMs: 300_000 },
  },
];

/**
 * Opções padrão aplicadas a todo job, por fila. `retry` troca a política de
 * repetição da fila pela de um job específico (ver `QueueSchedule.retry`).
 *
 * Jobs concluídos são descartados após uma janela curta — o resultado já foi
 * entregue a quem esperava, e o histórico de sucesso não é consultado. Jobs
 * falhos **permanecem** registrados: é o que permite diagnosticar a falha e o
 * que distingue, na espera, um job que falhou de um que apenas não concluiu a
 * tempo.
 */
export function buildJobOptions(
  queue: QueueName,
  retry?: QueueRetryPolicy,
): DefaultJobOptions {
  const { attempts, backoffMs } = retry ?? QUEUE_RETRY_POLICIES[queue];

  return {
    attempts,
    backoff: { type: 'exponential', delay: backoffMs },
    removeOnComplete: { age: 3_600, count: 1_000 },
    removeOnFail: false,
  };
}

/**
 * Intervalo entre consultas ao estado de um job durante a espera pela
 * conclusão. Define a granularidade da resposta: um job concluído é percebido,
 * no pior caso, um intervalo depois — irrelevante diante do tempo de uma
 * consulta a fonte externa, que é o que se está esperando.
 */
export const QUEUE_WAIT_POLL_INTERVAL_MS = 200;

/**
 * Tempo máximo para publicar um job.
 *
 * O cliente mantém uma fila interna de comandos enquanto tenta reconectar, e
 * sem este corte uma publicação ficaria pendurada esperando o Redis voltar —
 * junto com a requisição que a originou.
 */
export const QUEUE_PUBLISH_BUDGET_MS = 2_000;

/**
 * Conexão com o Redis a partir da configuração validada.
 *
 * `lazyConnect` mantém o mesmo comportamento adotado para o banco: a aplicação
 * sobe com o Redis fora do ar e o health check reporta a falha, em vez de
 * impedir o boot.
 *
 * `maxRetriesPerRequest: null` é exigência do BullMQ para as conexões
 * bloqueantes dos consumidores — e esta API passou a hospedar um deles, o
 * envio de e-mails. Com qualquer outro valor, o BullMQ sobrescreve a opção e
 * registra um aviso a cada conexão. Quem protege o lado produtor de uma espera
 * indefinida é `QUEUE_PUBLISH_BUDGET_MS`, não o número de tentativas.
 */
export function buildQueueConnection(
  configService: ConfigService<Environment, true>,
): RedisOptions {
  return {
    url: configService.get('REDIS_URL', { infer: true }),
    lazyConnect: true,
    maxRetriesPerRequest: null,
  };
}

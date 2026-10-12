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
  },
];

/**
 * Opções padrão aplicadas a todo job, por fila.
 *
 * Jobs concluídos são descartados após uma janela curta — o resultado já foi
 * entregue a quem esperava, e o histórico de sucesso não é consultado. Jobs
 * falhos **permanecem** registrados: é o que permite diagnosticar a falha e o
 * que distingue, na espera, um job que falhou de um que apenas não concluiu a
 * tempo.
 */
export function buildJobOptions(queue: QueueName): DefaultJobOptions {
  const { attempts, backoffMs } = QUEUE_RETRY_POLICIES[queue];

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
 * Conexão com o Redis a partir da configuração validada.
 *
 * `lazyConnect` mantém o mesmo comportamento adotado para o banco: a aplicação
 * sobe com o Redis fora do ar e o health check reporta a falha, em vez de
 * impedir o boot.
 *
 * `maxRetriesPerRequest: 1` vale para conexões produtoras, que é o papel desta
 * API: o comando falha rápido em vez de pendurar a requisição do usuário. Um
 * consumidor (Worker) hospedado aqui exigiria `null`, porque usa conexão
 * bloqueante.
 */
export function buildQueueConnection(
  configService: ConfigService<Environment, true>,
): RedisOptions {
  return {
    url: configService.get('REDIS_URL', { infer: true }),
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  };
}

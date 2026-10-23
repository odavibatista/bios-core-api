/**
 * Filas do sistema.
 *
 * A comunicação entre quem pede e quem processa acontece exclusivamente
 * por estas filas, sem chamadas HTTP entre os serviços
 * (`14-Projeto-e-Arquitetura.md`, seção 2). Cada fila tem um único consumidor,
 * que vive no módulo dono do fluxo, dentro do próprio core: hoje o e-mail, o
 * cadastro por CNPJ e o lote diário do IBAMA já têm o seu, e os das demais
 * entram com as respectivas fontes.
 */
export const QueueName = {
  /** Dados cadastrais por CNPJ (BrasilAPI → OpenCNPJ → Minha Receita + IBGE). */
  COMPANY_PROFILE: 'company-profile',

  /** Evidências de conduta da CGU (CEIS/CNEP): jobs curtos de quem espera a resposta. */
  ENVIRONMENTAL_EVIDENCES: 'environmental-evidences',

  /** Dumps do IBAMA (lote diário e coleta avulsa): jobs pesados, um por vez (#262). */
  IBAMA_INGESTION: 'ibama-ingestion',

  /** Inventário de emissões (fallback do GHG Protocol). */
  GHG_INVENTORY: 'ghg-inventory',

  /** Recálculo de índice e confiança por ODS. */
  ODS_SCORING: 'ods-scoring',

  /** Envio de e-mails transacionais. */
  EMAIL_DISPATCH: 'email-dispatch',
} as const;

export type QueueName = (typeof QueueName)[keyof typeof QueueName];

/** Todas as filas declaradas, na ordem de declaração. */
export const QUEUE_NAMES: readonly QueueName[] = Object.values(QueueName);

/** Opções de um job avulso. */
export interface EnqueueOptions {
  /**
   * Identificador do job. Dois jobs com o mesmo `jobId` na mesma fila são o
   * mesmo job: é o que evita enfileirar duas vezes o mesmo CNPJ enquanto o
   * primeiro pedido ainda está em processamento.
   */
  jobId?: string;

  /** Atraso antes de o job ficar disponível para consumo, em milissegundos. */
  delayMs?: number;
}

/** Opções da espera pela conclusão de um job. */
export interface EnqueueAndWaitOptions extends EnqueueOptions {
  /**
   * Tempo máximo de espera, em milissegundos. Ausente, vale o configurado em
   * `QUEUE_WAIT_TIMEOUT_MS`.
   */
  timeoutMs?: number;
}

/**
 * Política de repetição de uma fila: tentativas e o atraso base do backoff
 * exponencial (o atraso dobra a cada tentativa).
 */
export interface QueueRetryPolicy {
  /** Total de tentativas, incluindo a primeira. */
  attempts: number;

  /** Atraso antes da segunda tentativa, em milissegundos. */
  backoffMs: number;
}

/**
 * Job repetível: o próprio BullMQ reenfileira conforme o padrão cron, sem
 * agendador externo.
 */
export interface QueueSchedule {
  /** Fila em que o job é publicado. */
  queue: QueueName;

  /**
   * Identificador estável do agendamento. É a chave da idempotência: registrar
   * o mesmo `id` novamente atualiza o agendamento em vez de criar outro, de
   * modo que reiniciar a API não duplica o disparo.
   */
  id: string;

  /** Nome do job publicado a cada disparo. */
  jobName: string;

  /** Padrão cron do disparo (fuso do processo). */
  cron: string;

  /**
   * Política de repetição **deste** job, no lugar da política da fila.
   *
   * A fila é compartilhada: o lote diário (centenas de milhares de registros,
   * minutos por tentativa, uma fonte que costuma ficar fora por horas) e os
   * jobs por CNPJ (que erram rápido para quem espera) têm necessidades
   * opostas, e a política da fila só atende a segunda. Ausente, vale a da fila.
   */
  retry?: QueueRetryPolicy;
}

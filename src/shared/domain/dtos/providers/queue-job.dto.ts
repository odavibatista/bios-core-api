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

  /**
   * Coalescência exata pelo `jobId` (exige `jobId`): vários pedidos do mesmo
   * trabalho viram um só **enquanto ele não começou**, sem nunca perder uma mudança.
   *
   * O BullMQ trata o mesmo `jobId` como o mesmo job enquanto o registro existir, e
   * jobs concluídos ficam por uma hora e os falhos para sempre: sem isto, um pedido
   * feito depois de o job terminar seria ignorado e devolveria o resultado velho.
   * Com `coalesce`:
   *  - job **pendente** (esperando ou agendado): o pedido se funde a ele (ele ainda vai
   *    ler os dados mais novos);
   *  - job **concluído ou falho**: o registro é removido e um job novo é publicado;
   *  - job **ativo**: ele pode já ter lido os dados antigos, então um job de acompanhamento
   *    (`<jobId>~next`) é publicado, e os pedidos seguintes se fundem a ele enquanto estiver
   *    pendente; se o acompanhamento também já começou, o próximo elo da cadeia
   *    (`<jobId>~next~next`) recebe o pedido, e assim por diante (a cadeia tem o tamanho dos
   *    jobs ativos ao mesmo tempo, que a concorrência do consumidor limita).
   *
   * Quem usa deve tolerar dois jobs do mesmo `jobId` ao mesmo tempo (o ativo e o
   * acompanhamento): o trabalho precisa ser idempotente e não regredir um resultado mais novo.
   */
  coalesce?: boolean;
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
   * Variável de ambiente que, quando declarada, substitui `cron` (que fica como o padrão
   * documentado). Lida pelo registro dos agendamentos na inicialização.
   */
  cronSetting?: 'SECTOR_SNAPSHOT_CRON';

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

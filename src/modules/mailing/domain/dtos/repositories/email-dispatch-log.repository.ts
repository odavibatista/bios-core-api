import type { EmailTemplate } from '@prisma/client';

/** Registro de auditoria a ser criado, antes do envio. */
export interface NewEmailDispatchLog {
  template: EmailTemplate;

  /**
   * Hash do destinatário. O e-mail em claro não entra na coleção nem em log
   * (INL02); o hash permite auditar e correlacionar disparos sem guardá-lo.
   */
  recipientEmailHash: string;

  /** Job responsável pelo envio. */
  jobId: string;

  /** Usuário destinatário, quando o e-mail pertence a uma conta existente. */
  userId?: string;
}

/**
 * Contrato de auditoria dos disparos de e-mail (RF18).
 *
 * Classe abstrata (e não interface) para servir também como token de injeção.
 */
export abstract class EmailDispatchLogRepository {
  /** Cria o registro como `QUEUED` e devolve seu identificador. */
  abstract create(log: NewEmailDispatchLog): Promise<string>;

  /** Marca o disparo como enviado, com a data do envio. */
  abstract markSent(id: string): Promise<void>;

  /** Marca o disparo como falho, com o motivo técnico. */
  abstract markFailed(id: string, reason: string): Promise<void>;
}

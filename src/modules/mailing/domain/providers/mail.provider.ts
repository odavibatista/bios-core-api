import type { MailMessage } from '../dtos/providers/mail-message.dto.js';

/**
 * Contrato de transporte de e-mail (RF18).
 *
 * Só entrega a mensagem ao servidor de e-mail. Quem decide reenviar é a fila, e
 * quem registra o resultado é o processor: uma falha aqui é propagada, não
 * tratada.
 *
 * Classe abstrata (e não interface) para servir também como token de injeção.
 */
export abstract class MailProvider {
  abstract send(message: MailMessage): Promise<void>;
}

import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '@shared/config/environment.config.js';
import type { Transporter } from 'nodemailer';
import type { MailMessage } from '../../domain/dtos/providers/mail-message.dto.js';
import { MailProvider } from '../../domain/providers/mail.provider.js';

/** Token do transporte de e-mail, construído pelo `MailingModule`. */
export const MAIL_TRANSPORT = Symbol('MAIL_TRANSPORT');

/**
 * Transporte de e-mail por SMTP (RF18).
 *
 * O remetente é único e vem da configuração (`MAIL_FROM`): quem dispara escolhe
 * o destinatário e o conteúdo, nunca de onde o e-mail parte.
 *
 * Falha de envio é propagada de propósito — reenviar é decisão da fila, e
 * registrar o resultado é do processor.
 */
@Injectable()
export class NodemailerMailProvider extends MailProvider {
  private readonly from: string;

  constructor(
    @Inject(MAIL_TRANSPORT) private readonly transport: Transporter,
    configService: ConfigService<Environment, true>,
  ) {
    super();
    this.from = configService.get('MAIL_FROM', { infer: true });
  }

  override async send({ to, subject, html }: MailMessage): Promise<void> {
    await this.transport.sendMail({ from: this.from, to, subject, html });
  }
}

import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '@shared/config/environment.config.js';
import { createTransport } from 'nodemailer';
import { EmailDispatchLogRepository } from '../../domain/dtos/repositories/email-dispatch-log.repository.js';
import { MailProvider } from '../../domain/providers/mail.provider.js';
import { PrismaEmailDispatchLogRepository } from '../db/repositories/prisma-email-dispatch-log.repository.js';
import {
  MAIL_TRANSPORT,
  NodemailerMailProvider,
} from '../providers/nodemailer-mail.provider.js';
import { EmailDispatchProcessor } from '../queue/email-dispatch.processor.js';
import { DispatchEmailUseCase } from '../usecases/dispatch-email.usecase.js';

/**
 * E-mails transacionais: enfileiramento, auditoria de envio e o consumidor que
 * entrega as mensagens (RF18).
 *
 * Entidades (schemas Prisma em `../../entity`): `EmailDispatchLog`.
 *
 * Exporta apenas o caso de uso: os outros módulos disparam e-mail, nunca
 * enviam. Quem envia é o processor da fila.
 */
@Module({
  providers: [
    /* Transporte: conexão SMTP reaproveitada entre envios (pool) */
    {
      provide: MAIL_TRANSPORT,
      inject: [ConfigService],
      useFactory: (configService: ConfigService<Environment, true>) =>
        createTransport({
          host: configService.get('SMTP_HOST', { infer: true }),
          port: configService.get('SMTP_PORT', { infer: true }),
          // Porta 465 fala TLS desde o primeiro byte; as demais usam STARTTLS.
          secure: configService.get('SMTP_PORT', { infer: true }) === 465,
          auth: {
            user: configService.get('SMTP_USER', { infer: true }),
            pass: configService.get('SMTP_PASSWORD', { infer: true }),
          },
          pool: true,
        }),
    },

    /* Repositórios */
    {
      provide: EmailDispatchLogRepository,
      useClass: PrismaEmailDispatchLogRepository,
    },

    /* Providers */
    { provide: MailProvider, useClass: NodemailerMailProvider },

    /* Casos de uso */
    DispatchEmailUseCase,

    /* Consumidor da fila */
    EmailDispatchProcessor,
  ],
  exports: [DispatchEmailUseCase],
})
export class MailingModule {}

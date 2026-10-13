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
import { SendTransactionalEmailUseCase } from '../usecases/send-transactional-email.usecase.js';
import { TemplateRendererProvider } from '../../domain/providers/template-renderer.provider.js';
import { HandlebarsTemplateRendererProvider } from '../providers/handlebars-template-renderer.provider.js';

/**
 * E-mails transacionais: enfileiramento, auditoria de envio e o consumidor que
 * entrega as mensagens (RF18).
 *
 * Entidades (schemas Prisma em `../../entity`): `EmailDispatchLog`.
 *
 * Exporta apenas os casos de uso: os outros módulos pedem o envio de um
 * template, nunca montam ou entregam a mensagem. Quem renderiza é o
 * `TemplateRendererProvider`; quem entrega é o processor da fila.
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
    {
      provide: TemplateRendererProvider,
      useClass: HandlebarsTemplateRendererProvider,
    },

    /* Casos de uso */
    DispatchEmailUseCase,
    SendTransactionalEmailUseCase,

    /* Consumidor da fila */
    EmailDispatchProcessor,
  ],
  exports: [SendTransactionalEmailUseCase, DispatchEmailUseCase],
})
export class MailingModule {}

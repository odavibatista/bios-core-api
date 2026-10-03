import { Module } from '@nestjs/common';

/**
 * E-mails transacionais: enfileiramento, renderização de templates e
 * auditoria de envio (RF18).
 *
 * Entidades (schemas Prisma em `../../entity`): `EmailDispatchLog`.
 */
@Module({})
export class MailingModule {}

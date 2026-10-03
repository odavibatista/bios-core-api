import { Global, Module } from '@nestjs/common';
import { DatabaseHealthProvider } from '../../domain/providers/database-health.provider.js';
import { PrismaService } from './prisma.service.js';

/**
 * Módulo global de acesso ao banco de dados.
 *
 * Expõe o `PrismaService` para os repositórios de todos os módulos e o
 * associa ao contrato `DatabaseHealthProvider`.
 */
@Global()
@Module({
  providers: [
    PrismaService,
    { provide: DatabaseHealthProvider, useExisting: PrismaService },
  ],
  exports: [PrismaService, DatabaseHealthProvider],
})
export class DatabaseModule {}

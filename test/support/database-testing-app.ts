import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '@app/app.module.js';
import { PrismaService } from '@shared/infra/database/prisma.service.js';

export interface DatabaseTestingApp {
  app: INestApplication;
  prisma: PrismaService;
}

/**
 * Sobe o `AppModule` completo conectado ao banco descartável de testes
 * (DATABASE_URL definida em vitest.config.e2e.ts), sem substituir providers.
 */
export async function createDatabaseTestingApp(): Promise<DatabaseTestingApp> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleRef.createNestApplication();
  await app.init();

  return { app, prisma: app.get(PrismaService) };
}

import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import { AppModule } from '@app/app.module.js';
import { PrismaService } from '@shared/infra/database/prisma.service.js';

export interface DatabaseTestingApp {
  app: INestApplication;
  prisma: PrismaService;
}

/**
 * Sobe o `AppModule` completo conectado ao banco descartável de testes
 * (DATABASE_URL definida em vitest.config.e2e.ts).
 *
 * Nenhum provider é substituído por padrão. `configure` permite trocar apenas
 * o que sai do processo — ex.: o transporte de e-mail por um dublê que
 * registra as mensagens —, mantendo banco, fila e pipeline HTTP reais.
 */
export async function createDatabaseTestingApp(
  configure?: (builder: TestingModuleBuilder) => void,
): Promise<DatabaseTestingApp> {
  const builder = Test.createTestingModule({ imports: [AppModule] });
  configure?.(builder);

  const app = (await builder.compile()).createNestApplication();
  await app.init();
  // O supertest sobe o servidor a cada requisição enquanto ele não está ouvindo, e
  // as requisições simultâneas se enfileiram em `once('listening' | 'error' |
  // 'close')` do mesmo servidor: com 11 ou mais, o Node avisa de vazamento de
  // ouvintes (#259). Ouvindo desde já, em porta livre, cada requisição vai direto.
  await app.listen(0);

  return { app, prisma: app.get(PrismaService) };
}

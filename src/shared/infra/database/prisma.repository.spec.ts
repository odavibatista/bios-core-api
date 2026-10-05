import type { Prisma } from '@prisma/client';
import { faker } from '@test/support/faker.js';
import type { PaginationQuery } from '../../domain/dtos/requests/pagination.dto.js';
import { PrismaRepository } from './prisma.repository.js';
import type { PrismaService } from './prisma.service.js';

class SampleRepository extends PrismaRepository {
  constructor(prisma: PrismaService) {
    super(prisma);
  }

  paginate(query: PaginationQuery) {
    return this.toPagination(query);
  }

  runInTransaction<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>) {
    return this.transaction(operation);
  }
}

describe('PrismaRepository', () => {
  const transactionClient = {} as Prisma.TransactionClient;
  const prisma = {
    $transaction: vi.fn(
      (operation: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
        operation(transactionClient),
    ),
  } as unknown as PrismaService;

  const repository = new SampleRepository(prisma);

  it('começa do primeiro registro na página 1', () => {
    const page_size = faker.number.int({ min: 1, max: 100 });

    expect(repository.paginate({ page: 1, page_size })).toEqual({
      skip: 0,
      take: page_size,
    });
  });

  it('pula os registros das páginas anteriores', () => {
    const page = faker.number.int({ min: 2, max: 1_000 });
    const page_size = faker.number.int({ min: 1, max: 100 });

    expect(repository.paginate({ page, page_size })).toEqual({
      skip: (page - 1) * page_size,
      take: page_size,
    });
  });

  it('executa a operação dentro de uma transação Prisma', async () => {
    const result = faker.lorem.word();
    const operation = vi.fn().mockResolvedValue(result);

    await expect(repository.runInTransaction(operation)).resolves.toBe(result);
    expect(operation).toHaveBeenCalledWith(transactionClient);
  });
});

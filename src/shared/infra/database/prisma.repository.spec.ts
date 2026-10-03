import type { Prisma } from '@prisma/client';
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

  it.each([
    [
      { page: 1, page_size: 20 },
      { skip: 0, take: 20 },
    ],
    [
      { page: 3, page_size: 50 },
      { skip: 100, take: 50 },
    ],
  ])('converte a paginação %o em %o', (query, expected) => {
    expect(repository.paginate(query)).toEqual(expected);
  });

  it('executa a operação dentro de uma transação Prisma', async () => {
    const operation = vi.fn().mockResolvedValue('resultado');

    await expect(repository.runInTransaction(operation)).resolves.toBe(
      'resultado',
    );
    expect(operation).toHaveBeenCalledWith(transactionClient);
  });
});

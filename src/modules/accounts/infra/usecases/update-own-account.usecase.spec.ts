import { Test } from '@nestjs/testing';
import { UserRole } from '@prisma/client';
import { faker } from '@test/support/faker.js';
import { AccountNotFoundException } from '../../domain/dtos/errors/account-not-found.exception.js';
import type { Address } from '../../domain/dtos/requests/address.dto.js';
import { GetOwnAccountUseCase } from './get-own-account.usecase.js';
import { UpdateAccountUseCase } from './update-account.usecase.js';
import { UpdateOwnAccountUseCase } from './update-own-account.usecase.js';

describe('UpdateOwnAccountUseCase', () => {
  const updateAccount = {
    execute: vi.fn<UpdateAccountUseCase['execute']>(),
  };
  const getOwnAccount = { execute: vi.fn<GetOwnAccountUseCase['execute']>() };
  const userId = faker.database.mongodbObjectId();
  const view = {
    id: userId,
    name: faker.person.fullName(),
    email: faker.internet.email(),
    address: null,
    role: UserRole.USER,
  };
  let useCase: UpdateOwnAccountUseCase;

  const address: Address = {
    postal_code: '01310-100',
    street: 'Avenida Paulista',
    number: '1578',
    neighborhood: 'Bela Vista',
    city: 'São Paulo',
    state: 'SP',
  };

  beforeEach(async () => {
    updateAccount.execute.mockResolvedValue('UPDATED');
    getOwnAccount.execute.mockResolvedValue(view);

    const moduleRef = await Test.createTestingModule({
      providers: [
        UpdateOwnAccountUseCase,
        { provide: UpdateAccountUseCase, useValue: updateAccount },
        { provide: GetOwnAccountUseCase, useValue: getOwnAccount },
      ],
    }).compile();

    useCase = moduleRef.get(UpdateOwnAccountUseCase);
  });

  it('altera o nome e devolve a conta atualizada', async () => {
    await expect(
      useCase.execute({ userId, name: 'Maria Souza' }),
    ).resolves.toBe(view);

    expect(updateAccount.execute).toHaveBeenCalledWith({
      userId,
      changes: { name: 'Maria Souza', address: undefined },
    });
    expect(getOwnAccount.execute).toHaveBeenCalledWith(userId);
  });

  it('altera o endereço', async () => {
    await useCase.execute({ userId, address });

    expect(updateAccount.execute).toHaveBeenCalledWith({
      userId,
      changes: { name: undefined, address },
    });
  });

  it('remove o endereço quando recebe null', async () => {
    await useCase.execute({ userId, address: null });

    expect(updateAccount.execute).toHaveBeenCalledWith({
      userId,
      changes: { name: undefined, address: null },
    });
  });

  it('nunca altera o e-mail por este caminho', async () => {
    await useCase.execute({ userId, name: 'Maria Souza' });

    const [{ changes }] = updateAccount.execute.mock.calls[0];
    expect(changes).not.toHaveProperty('email');
    expect(changes).not.toHaveProperty('password');
  });

  it.each(['NOT_FOUND', 'EMAIL_TAKEN'] as const)(
    'recusa quando a gravação devolve %s, sem ler a conta',
    async (outcome) => {
      updateAccount.execute.mockResolvedValue(outcome);

      await expect(
        useCase.execute({ userId, name: 'Maria Souza' }),
      ).rejects.toBeInstanceOf(AccountNotFoundException);

      expect(getOwnAccount.execute).not.toHaveBeenCalled();
    },
  );

  it('propaga a falha ao gravar', async () => {
    updateAccount.execute.mockRejectedValue(new Error('banco fora'));

    await expect(useCase.execute({ userId, name: 'Nome' })).rejects.toThrow(
      'banco fora',
    );
  });
});

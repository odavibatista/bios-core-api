import { Test } from '@nestjs/testing';
import { UserRole } from '@prisma/client';
import { EncryptionProvider } from '@shared/domain/providers/encryption.provider.js';
import { faker } from '@test/support/faker.js';
import { serializeAddress } from '../../domain/address.js';
import { AccountNotFoundException } from '../../domain/dtos/errors/account-not-found.exception.js';
import {
  type AccountProfile,
  UserRepository,
} from '../../domain/dtos/repositories/user.repository.js';
import type { Address } from '../../domain/dtos/requests/address.dto.js';
import { GetOwnAccountUseCase } from './get-own-account.usecase.js';

describe('GetOwnAccountUseCase', () => {
  const userRepository = {
    findProfileById: vi.fn<UserRepository['findProfileById']>(),
  };
  const encryptionProvider = {
    decrypt: vi.fn<EncryptionProvider['decrypt']>(),
  };
  let useCase: GetOwnAccountUseCase;

  const address: Address = {
    postal_code: '01310100',
    street: 'Avenida Paulista',
    number: '1578',
    neighborhood: 'Bela Vista',
    city: 'São Paulo',
    state: 'SP',
  };

  function buildProfile(
    overrides: Partial<AccountProfile> = {},
  ): AccountProfile {
    return {
      id: faker.database.mongodbObjectId(),
      name: faker.person.fullName(),
      isActive: true,
      role: UserRole.USER,
      emailEncrypted: 'email-cifrado',
      addressEncrypted: null,
      encryptionKeyVersion: 2,
      ...overrides,
    };
  }

  beforeEach(async () => {
    encryptionProvider.decrypt.mockImplementation(({ ciphertext }) =>
      ciphertext === 'email-cifrado'
        ? 'pessoa@exemplo.com'
        : serializeAddress(address),
    );

    const moduleRef = await Test.createTestingModule({
      providers: [
        GetOwnAccountUseCase,
        { provide: UserRepository, useValue: userRepository },
        { provide: EncryptionProvider, useValue: encryptionProvider },
      ],
    }).compile();

    useCase = moduleRef.get(GetOwnAccountUseCase);
  });

  it('devolve nome, papel e e-mail decifrado, com a versão da chave do documento', async () => {
    const profile = buildProfile({ role: UserRole.ADMIN });
    userRepository.findProfileById.mockResolvedValue(profile);

    await expect(useCase.execute(profile.id)).resolves.toEqual({
      id: profile.id,
      name: profile.name,
      email: 'pessoa@exemplo.com',
      address: null,
      role: UserRole.ADMIN,
    });
    expect(encryptionProvider.decrypt).toHaveBeenCalledWith({
      ciphertext: 'email-cifrado',
      keyVersion: 2,
    });
  });

  it('devolve o endereço decifrado quando a conta tem', async () => {
    const profile = buildProfile({ addressEncrypted: 'endereco-cifrado' });
    userRepository.findProfileById.mockResolvedValue(profile);

    const account = await useCase.execute(profile.id);

    expect(account.address).toEqual(address);
    expect(encryptionProvider.decrypt).toHaveBeenCalledWith({
      ciphertext: 'endereco-cifrado',
      keyVersion: 2,
    });
  });

  it('não decifra endereço quando a conta não tem', async () => {
    const profile = buildProfile();
    userRepository.findProfileById.mockResolvedValue(profile);

    await useCase.execute(profile.id);

    expect(encryptionProvider.decrypt).toHaveBeenCalledOnce();
  });

  it('não devolve campos cifrados nem a senha', async () => {
    const profile = buildProfile({ addressEncrypted: 'endereco-cifrado' });
    userRepository.findProfileById.mockResolvedValue(profile);

    const account = await useCase.execute(profile.id);

    expect(Object.keys(account).sort()).toEqual([
      'address',
      'email',
      'id',
      'name',
      'role',
    ]);
  });

  it('recusa quando a conta não existe mais', async () => {
    userRepository.findProfileById.mockResolvedValue(null);

    await expect(
      useCase.execute(faker.database.mongodbObjectId()),
    ).rejects.toBeInstanceOf(AccountNotFoundException);
  });

  it('falha, em vez de devolver endereço malformado, quando o documento está corrompido', async () => {
    userRepository.findProfileById.mockResolvedValue(
      buildProfile({ addressEncrypted: 'endereco-cifrado' }),
    );
    encryptionProvider.decrypt.mockReturnValue('{"foo":"bar"}');

    await expect(
      useCase.execute(faker.database.mongodbObjectId()),
    ).rejects.toThrow();
  });
});

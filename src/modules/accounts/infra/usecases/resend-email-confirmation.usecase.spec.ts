import { Test } from '@nestjs/testing';
import { EncryptionProvider } from '@shared/domain/providers/encryption.provider.js';
import { faker } from '@test/support/faker.js';
import {
  type AccountIdentity,
  UserRepository,
} from '../../domain/dtos/repositories/user.repository.js';
import { ResendEmailConfirmationUseCase } from './resend-email-confirmation.usecase.js';
import { SendEmailConfirmationUseCase } from './send-email-confirmation.usecase.js';

describe('ResendEmailConfirmationUseCase', () => {
  const encryptionProvider = {
    blindIndex: vi.fn<EncryptionProvider['blindIndex']>(),
  };
  const userRepository = {
    findByEmailHash: vi.fn<UserRepository['findByEmailHash']>(),
  };
  const sendEmailConfirmation = {
    execute: vi.fn<SendEmailConfirmationUseCase['execute']>(),
  };
  let useCase: ResendEmailConfirmationUseCase;

  function buildAccount(overrides: Partial<AccountIdentity> = {}) {
    return {
      id: faker.database.mongodbObjectId(),
      name: faker.person.fullName(),
      isActive: false,
      ...overrides,
    };
  }

  beforeEach(async () => {
    encryptionProvider.blindIndex.mockImplementation((value) => `idx:${value}`);
    userRepository.findByEmailHash.mockResolvedValue(null);
    sendEmailConfirmation.execute.mockResolvedValue(undefined);

    const moduleRef = await Test.createTestingModule({
      providers: [
        ResendEmailConfirmationUseCase,
        { provide: EncryptionProvider, useValue: encryptionProvider },
        { provide: UserRepository, useValue: userRepository },
        {
          provide: SendEmailConfirmationUseCase,
          useValue: sendEmailConfirmation,
        },
      ],
    }).compile();

    useCase = moduleRef.get(ResendEmailConfirmationUseCase);
  });

  it('envia novo link à conta ainda inativa, localizada pelo e-mail normalizado', async () => {
    const email = faker.internet.email().toLowerCase();
    const account = buildAccount();
    userRepository.findByEmailHash.mockResolvedValue(account);

    await useCase.execute({ email: ` ${email.toUpperCase()} ` });

    expect(userRepository.findByEmailHash).toHaveBeenCalledWith(`idx:${email}`);
    expect(sendEmailConfirmation.execute).toHaveBeenCalledWith({
      userId: account.id,
      name: account.name,
      email,
    });
  });

  it('não envia nada para e-mail sem conta, e não falha', async () => {
    userRepository.findByEmailHash.mockResolvedValue(null);

    await expect(
      useCase.execute({ email: faker.internet.email() }),
    ).resolves.toBeUndefined();
    expect(sendEmailConfirmation.execute).not.toHaveBeenCalled();
  });

  it('não envia nada para conta já ativa, e não falha', async () => {
    userRepository.findByEmailHash.mockResolvedValue(
      buildAccount({ isActive: true }),
    );

    await expect(
      useCase.execute({ email: faker.internet.email() }),
    ).resolves.toBeUndefined();
    expect(sendEmailConfirmation.execute).not.toHaveBeenCalled();
  });
});

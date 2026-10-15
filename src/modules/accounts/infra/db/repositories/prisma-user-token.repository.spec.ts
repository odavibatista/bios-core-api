import { Test } from '@nestjs/testing';
import { type UserToken, UserTokenPurpose } from '@prisma/client';
import { PrismaService } from '@shared/infra/database/prisma.service.js';
import { userTokenFactory } from '@test/factories/accounts/user-token.factory.js';
import { faker } from '@test/support/faker.js';
import { PrismaUserTokenRepository } from './prisma-user-token.repository.js';

describe('PrismaUserTokenRepository', () => {
  const updateMany = vi.fn<() => Promise<{ count: number }>>();
  const create = vi.fn<() => Promise<unknown>>();
  const findUnique = vi.fn<() => Promise<UserToken | null>>();
  const transactionClient = { userToken: { updateMany, create } };
  const prisma = {
    userToken: { findUnique, updateMany },
    $transaction: vi.fn(
      (operation: (client: typeof transactionClient) => Promise<unknown>) =>
        operation(transactionClient),
    ),
  };
  let repository: PrismaUserTokenRepository;

  beforeEach(async () => {
    vi.clearAllMocks();
    updateMany.mockResolvedValue({ count: 1 });
    create.mockResolvedValue(undefined);
    findUnique.mockResolvedValue(null);

    const moduleRef = await Test.createTestingModule({
      providers: [
        PrismaUserTokenRepository,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    repository = moduleRef.get(PrismaUserTokenRepository);
  });

  describe('replacePending', () => {
    const request = () => ({
      userId: faker.database.mongodbObjectId(),
      purpose: faker.helpers.objectValue(UserTokenPurpose),
      tokenHash: faker.string.hexadecimal({ length: 64, prefix: '' }),
      expiresAt: faker.date.soon(),
    });

    it('invalida os pendentes da mesma finalidade antes de gravar o novo', async () => {
      const token = request();

      await repository.replacePending(token);

      expect(updateMany).toHaveBeenCalledWith({
        where: {
          user_id: token.userId,
          purpose: token.purpose,
          used_at: null,
        },
        data: { used_at: expect.any(Date) },
      });
      expect(updateMany.mock.invocationCallOrder[0]).toBeLessThan(
        create.mock.invocationCallOrder[0],
      );
    });

    it('grava só o resumo do token, com a validade', async () => {
      const token = request();

      await repository.replacePending(token);

      expect(create).toHaveBeenCalledWith({
        data: {
          user_id: token.userId,
          purpose: token.purpose,
          token_hash: token.tokenHash,
          expires_at: token.expiresAt,
          pending_email_encrypted: undefined,
        },
      });
    });

    it('guarda o novo e-mail cifrado na troca de e-mail', async () => {
      const pendingEmailEncrypted = faker.string.alphanumeric(64);

      await repository.replacePending({
        ...request(),
        purpose: UserTokenPurpose.EMAIL_CHANGE,
        pendingEmailEncrypted,
      });

      expect(create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          pending_email_encrypted: pendingEmailEncrypted,
        }),
      });
    });

    it('faz as duas escritas na mesma transação', async () => {
      await repository.replacePending(request());

      expect(prisma.$transaction).toHaveBeenCalledOnce();
    });

    it('não grava o novo token se a invalidação falhar', async () => {
      updateMany.mockRejectedValue(new Error('falha de rede'));

      await expect(repository.replacePending(request())).rejects.toThrow();
      expect(create).not.toHaveBeenCalled();
    });
  });

  describe('consume', () => {
    const now = new Date();

    function consumption(token: UserToken) {
      return { tokenHash: token.token_hash, purpose: token.purpose, now };
    }

    it('consome o token livre e o devolve marcado como usado', async () => {
      const token = userTokenFactory.build({
        expires_at: faker.date.future({ refDate: now }),
      });
      findUnique.mockResolvedValue(token);

      const consumed = await repository.consume(consumption(token));

      expect(consumed).toEqual({ ...token, used_at: now });
    });

    it('procura o token pelo resumo', async () => {
      const token = userTokenFactory.build();
      findUnique.mockResolvedValue(token);

      await repository.consume(consumption(token));

      expect(findUnique).toHaveBeenCalledWith({
        where: { token_hash: token.token_hash },
      });
    });

    it('marca o uso condicionado ao token ainda livre e dentro da validade', async () => {
      const token = userTokenFactory.build();
      findUnique.mockResolvedValue(token);

      await repository.consume(consumption(token));

      // Esta condição, e não a leitura anterior, decide a disputa entre dois
      // pedidos simultâneos com o mesmo link.
      expect(updateMany).toHaveBeenCalledWith({
        where: {
          id_user_token: token.id_user_token,
          used_at: null,
          expires_at: { gt: now },
        },
        data: { used_at: now },
      });
    });

    it('devolve null quando o token não existe', async () => {
      const token = userTokenFactory.build();
      findUnique.mockResolvedValue(null);

      await expect(repository.consume(consumption(token))).resolves.toBeNull();
      expect(updateMany).not.toHaveBeenCalled();
    });

    it('devolve null quando o token é de outra finalidade', async () => {
      const token = userTokenFactory.build({
        purpose: UserTokenPurpose.EMAIL_CONFIRMATION,
      });
      findUnique.mockResolvedValue(token);

      await expect(
        repository.consume({
          ...consumption(token),
          purpose: UserTokenPurpose.PASSWORD_RESET,
        }),
      ).resolves.toBeNull();
      expect(updateMany).not.toHaveBeenCalled();
    });

    it('devolve null quando outro pedido consumiu o token no meio do caminho', async () => {
      const token = userTokenFactory.build();
      findUnique.mockResolvedValue(token);
      updateMany.mockResolvedValue({ count: 0 });

      await expect(repository.consume(consumption(token))).resolves.toBeNull();
    });
  });
});

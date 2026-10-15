import { Test } from '@nestjs/testing';
import { PrismaService } from '@shared/infra/database/prisma.service.js';
import { faker } from '@test/support/faker.js';
import { PrismaUserSessionRepository } from './prisma-user-session.repository.js';

describe('PrismaUserSessionRepository', () => {
  const create = vi.fn();
  let repository: PrismaUserSessionRepository;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        PrismaUserSessionRepository,
        { provide: PrismaService, useValue: { userSession: { create } } },
      ],
    }).compile();

    repository = moduleRef.get(PrismaUserSessionRepository);
  });

  it('grava o elo só com o resumo do refresh token e devolve o identificador', async () => {
    const session = {
      userId: faker.database.mongodbObjectId(),
      familyId: faker.string.uuid(),
      refreshTokenHash: faker.string.hexadecimal({ length: 64, prefix: '' }),
      ip: faker.internet.ipv4(),
      userAgent: faker.internet.userAgent(),
      expiresAt: faker.date.future(),
    };
    const id = faker.database.mongodbObjectId();
    create.mockResolvedValue({ id_user_session: id });

    await expect(repository.create(session)).resolves.toBe(id);

    expect(create).toHaveBeenCalledWith({
      data: {
        user_id: session.userId,
        family_id: session.familyId,
        refresh_token_hash: session.refreshTokenHash,
        ip: session.ip,
        user_agent: session.userAgent,
        expires_at: session.expiresAt,
      },
      select: { id_user_session: true },
    });
  });

  it('aceita sessão sem user-agent', async () => {
    create.mockResolvedValue({
      id_user_session: faker.database.mongodbObjectId(),
    });

    await repository.create({
      userId: faker.database.mongodbObjectId(),
      familyId: faker.string.uuid(),
      refreshTokenHash: faker.string.hexadecimal({ length: 64, prefix: '' }),
      ip: faker.internet.ipv4(),
      expiresAt: faker.date.future(),
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ user_agent: undefined }),
      }),
    );
  });
});

import { Test } from '@nestjs/testing';
import { faker } from '@test/support/faker.js';
import { BlockedEmailDomainException } from '../../domain/dtos/errors/blocked-email-domain.exception.js';
import { BlockedEmailDomainRepository } from '../../domain/dtos/repositories/blocked-email-domain.repository.js';
import { CheckEmailDomainAllowedUseCase } from './check-email-domain-allowed.usecase.js';

describe('CheckEmailDomainAllowedUseCase', () => {
  const blockedEmailDomainRepository = {
    isBlocked: vi.fn<BlockedEmailDomainRepository['isBlocked']>(),
  };
  let useCase: CheckEmailDomainAllowedUseCase;

  beforeEach(async () => {
    blockedEmailDomainRepository.isBlocked.mockResolvedValue(false);

    const moduleRef = await Test.createTestingModule({
      providers: [
        CheckEmailDomainAllowedUseCase,
        {
          provide: BlockedEmailDomainRepository,
          useValue: blockedEmailDomainRepository,
        },
      ],
    }).compile();

    useCase = moduleRef.get(CheckEmailDomainAllowedUseCase);
  });

  it('deixa passar o e-mail de domínio fora da lista', async () => {
    const email = faker.internet.email();

    await expect(useCase.execute(email)).resolves.toBeUndefined();
  });

  it('recusa o e-mail de domínio bloqueado', async () => {
    blockedEmailDomainRepository.isBlocked.mockResolvedValue(true);

    await expect(
      useCase.execute(faker.internet.email()),
    ).rejects.toBeInstanceOf(BlockedEmailDomainException);
  });

  it('não revela qual domínio está bloqueado', async () => {
    blockedEmailDomainRepository.isBlocked.mockResolvedValue(true);
    const domain = faker.internet.domainName();

    const attempt = useCase.execute(`${faker.internet.username()}@${domain}`);

    // Entregar a lista permitiria contorná-la testando endereços.
    await expect(attempt).rejects.toMatchObject({
      code: 'EMAIL_DOMAIN_NOT_ALLOWED',
      details: undefined,
    });
    await expect(attempt).rejects.not.toThrow(new RegExp(domain));
  });

  describe('normalização do domínio', () => {
    it.each([
      ['maiúsculas', 'Usuario@Mailinator.COM'],
      ['espaços nas bordas', '  usuario@mailinator.com  '],
      ['subdomínio', 'usuario@mail.mailinator.com'],
    ])('consulta o domínio normalizado de %s', async (_case, email) => {
      await useCase.execute(email);

      const [domain] = blockedEmailDomainRepository.isBlocked.mock.calls[0];
      expect(domain).toBe(domain.toLowerCase().trim());
      expect(domain).not.toContain('@');
      expect(domain).not.toContain(' ');
    });

    it('usa o domínio inteiro, não um sufixo', async () => {
      await useCase.execute('usuario@naomailinator.com');

      expect(blockedEmailDomainRepository.isBlocked).toHaveBeenCalledWith(
        'naomailinator.com',
      );
    });

    it('usa o trecho depois do último @', async () => {
      await useCase.execute('"a@b"@mailinator.com');

      expect(blockedEmailDomainRepository.isBlocked).toHaveBeenCalledWith(
        'mailinator.com',
      );
    });
  });

  describe('texto sem domínio', () => {
    it.each(['sem-arroba', 'usuario@', '@dominio-sem-usuario.com'])(
      'não consulta a blacklist para "%s"',
      async (email) => {
        // E-mail malformado é erro de validação do schema, não da blacklist.
        await expect(useCase.execute(email)).resolves.toBeUndefined();
      },
    );
  });

  it('consulta o banco a cada chamada, sem cache', async () => {
    const email = faker.internet.email();

    await useCase.execute(email);
    blockedEmailDomainRepository.isBlocked.mockResolvedValue(true);

    // Um domínio recém-bloqueado precisa valer na consulta seguinte.
    await expect(useCase.execute(email)).rejects.toBeInstanceOf(
      BlockedEmailDomainException,
    );
    expect(blockedEmailDomainRepository.isBlocked).toHaveBeenCalledTimes(2);
  });
});

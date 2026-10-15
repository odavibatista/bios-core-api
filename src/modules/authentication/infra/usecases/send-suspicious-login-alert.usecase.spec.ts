import { Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { EmailTemplate } from '@prisma/client';
import { SendTransactionalEmailUseCase } from '@modules/mailing/infra/usecases/send-transactional-email.usecase.js';
import { faker } from '@test/support/faker.js';
import { SendSuspiciousLoginAlertUseCase } from './send-suspicious-login-alert.usecase.js';

describe('SendSuspiciousLoginAlertUseCase', () => {
  const sendTransactionalEmail = {
    execute: vi.fn<SendTransactionalEmailUseCase['execute']>(),
  };
  let useCase: SendSuspiciousLoginAlertUseCase;

  function buildAlert() {
    return {
      userId: faker.database.mongodbObjectId(),
      name: `${faker.string.alpha({ length: 6 })} ${faker.string.alpha({ length: 8 })}`,
      email: faker.internet.email(),
      ip: faker.internet.ipv4(),
      occurredAt: faker.date.recent(),
    };
  }

  beforeEach(async () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    sendTransactionalEmail.execute.mockResolvedValue(
      faker.database.mongodbObjectId(),
    );

    const moduleRef = await Test.createTestingModule({
      providers: [
        SendSuspiciousLoginAlertUseCase,
        {
          provide: SendTransactionalEmailUseCase,
          useValue: sendTransactionalEmail,
        },
      ],
    }).compile();

    useCase = moduleRef.get(SendSuspiciousLoginAlertUseCase);
  });

  it('envia o template de alerta ao titular, com o primeiro nome, a origem e o momento', async () => {
    const alert = buildAlert();

    await useCase.execute(alert);

    expect(sendTransactionalEmail.execute).toHaveBeenCalledWith({
      template: EmailTemplate.SUSPICIOUS_LOGIN_ALERT,
      to: alert.email,
      context: {
        name: alert.name.split(' ')[0],
        ipAddress: alert.ip,
        occurredAt: alert.occurredAt,
      },
      userId: alert.userId,
    });
  });

  it('não propaga a falha do envio, apenas a registra', async () => {
    sendTransactionalEmail.execute.mockRejectedValue(new Error('fila fora'));

    await expect(useCase.execute(buildAlert())).resolves.toBeUndefined();
    expect(Logger.prototype.error).toHaveBeenCalledOnce();
  });

  it('registra a conta afetada, sem o e-mail, quando o envio falha', async () => {
    sendTransactionalEmail.execute.mockRejectedValue(new Error('fila fora'));
    const alert = buildAlert();

    await useCase.execute(alert);

    const [message] = vi.mocked(Logger.prototype.error).mock.calls[0];
    expect(message).toContain(alert.userId);
    expect(String(message)).not.toContain(alert.email);
  });
});

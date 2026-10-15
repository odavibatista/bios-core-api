import { Injectable, Logger } from '@nestjs/common';
import { EmailTemplate } from '@prisma/client';
import { SendTransactionalEmailUseCase } from '@modules/mailing/infra/usecases/send-transactional-email.usecase.js';
import { UseCase } from '@shared/domain/protocols/use-case.protocol.js';
import { firstNameOf } from '@shared/domain/value-objects/email-address.js';

/** Titular a avisar e o evento suspeito. */
export interface SuspiciousLoginAlert {
  userId: string;

  /** Nome de exibição, de que sai a saudação. */
  name: string;

  /** E-mail em claro do titular. */
  email: string;

  /** Endereço de origem do evento. */
  ip: string;

  occurredAt: Date;
}

/**
 * Avisa o titular de atividade suspeita na conta (UC02 fluxo 3.2, UC17 fluxo
 * 3.1, RF18).
 *
 * **Melhor esforço.** Falha no envio é registrada e não propaga: o alerta
 * acompanha uma recusa de acesso (credenciais inválidas, sessão inválida), e
 * um erro de fila não pode trocar essa resposta por um erro interno nem
 * impedir as demais providências, como a revogação das sessões.
 */
@Injectable()
export class SendSuspiciousLoginAlertUseCase extends UseCase<
  SuspiciousLoginAlert,
  void
> {
  private readonly logger = new Logger(SendSuspiciousLoginAlertUseCase.name);

  constructor(
    private readonly sendTransactionalEmailUseCase: SendTransactionalEmailUseCase,
  ) {
    super();
  }

  override async execute({
    userId,
    name,
    email,
    ip,
    occurredAt,
  }: SuspiciousLoginAlert): Promise<void> {
    try {
      await this.sendTransactionalEmailUseCase.execute({
        template: EmailTemplate.SUSPICIOUS_LOGIN_ALERT,
        to: email,
        context: { name: firstNameOf(name), ipAddress: ip, occurredAt },
        userId,
      });
    } catch (error) {
      this.logger.error(
        `Alerta de login suspeito não enviado para a conta ${userId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}

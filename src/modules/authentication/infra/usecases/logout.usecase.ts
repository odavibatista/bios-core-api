import { Injectable } from '@nestjs/common';
import { SessionRevocationReason } from '@prisma/client';
import type { AuthenticatedUser } from '@shared/domain/dtos/authenticated-user.dto.js';
import { UseCase } from '@shared/domain/protocols/use-case.protocol.js';
import { UserSessionRepository } from '../../domain/dtos/repositories/user-session.repository.js';

/** Quem encerra a sessão e o alcance do encerramento. */
export interface LogoutCommand {
  user: AuthenticatedUser;

  /** Encerra as sessões de todos os dispositivos, e não só a deste. */
  allDevices: boolean;
}

/**
 * Encerra a sessão do dispositivo atual ou de todos os dispositivos do
 * usuário (UC03, RF23).
 *
 * Revogar o elo é o que invalida **os dois** tokens da sessão: o refresh token
 * deixa de ser aceito na renovação e o access token deixa de passar pelo guard,
 * que o confere contra o elo a cada requisição. Não há lista de tokens
 * revogados para manter nem espera pelo vencimento.
 *
 * Encerrar a sessão de um dispositivo revoga a família de rotação inteira
 * (`LOGOUT`) e não toca nas dos demais. O encerramento global revoga todas as
 * ativas do usuário (`LOGOUT_ALL_DEVICES`).
 */
@Injectable()
export class LogoutUseCase extends UseCase<LogoutCommand, void> {
  constructor(private readonly userSessionRepository: UserSessionRepository) {
    super();
  }

  override async execute({ user, allDevices }: LogoutCommand): Promise<void> {
    const revokedAt = new Date();

    if (allDevices) {
      await this.userSessionRepository.revokeAllActive(
        user.userId,
        SessionRevocationReason.LOGOUT_ALL_DEVICES,
        revokedAt,
      );

      return;
    }

    await this.userSessionRepository.revokeFamily(
      user.familyId,
      SessionRevocationReason.LOGOUT,
      revokedAt,
    );
  }
}

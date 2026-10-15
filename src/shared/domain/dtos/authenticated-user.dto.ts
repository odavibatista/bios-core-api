import type { UserRole } from '@prisma/client';

/**
 * Quem faz a requisição, como o guard de autenticação o estabelece a partir do
 * access token e do elo de sessão (NFSE05).
 *
 * Existe só em requisições autenticadas; os endpoints públicos não o têm.
 */
export interface AuthenticatedUser {
  /** Usuário dono da sessão. */
  userId: string;

  /** Elo da sessão (`sid`) a que o access token pertence. */
  sessionId: string;

  /** Família de rotação do elo: todas as sessões originadas do mesmo login. */
  familyId: string;

  /** Papel de acesso registrado no token. */
  role: UserRole;
}

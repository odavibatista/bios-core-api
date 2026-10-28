import { SetMetadata } from '@nestjs/common';
import type { UserRole } from '@prisma/client';

/** Chave do metadado com os papéis que podem usar a rota. */
export const REQUIRED_ROLES = 'bios:required-roles';

/**
 * Restringe o endpoint (ou o controller) aos papéis informados (11-Permissões).
 *
 * Vale sobre a autenticação, nunca no lugar dela: o guard de papel roda depois do de
 * autenticação e lê o papel que o access token traz. Sem sessão, a resposta continua `401`;
 * com sessão de outro papel, `403`. Rota sem `@Roles()` não tem restrição de papel.
 *
 * Ex.: `@Roles(UserRole.ADMIN)` no controller da blacklist de domínios (`[P12]`).
 */
export const Roles = (...roles: UserRole[]): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRED_ROLES, roles);

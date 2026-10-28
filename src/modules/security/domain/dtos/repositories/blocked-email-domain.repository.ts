import type { BlockedDomainOrigin } from '@prisma/client';

/** Domínio da blacklist, como o repositório o devolve. */
export interface BlockedEmailDomainRecord {
  id: string;
  domain: string;
  origin: BlockedDomainOrigin;
  createdAt: Date;
}

/**
 * Resultado da inclusão: `ADDED` (registro novo), `RESTORED` (domínio removido que voltou,
 * RF29) ou `ALREADY_BLOCKED` (o domínio já estava bloqueado).
 */
export type AddBlockedEmailDomainResult =
  | { outcome: 'ADDED' | 'RESTORED'; record: BlockedEmailDomainRecord }
  | { outcome: 'ALREADY_BLOCKED' };

/**
 * Contrato da blacklist de domínios de e-mail: consulta no cadastro (RF22) e manutenção
 * pelo administrador (RF29, UC13).
 *
 * Classe abstrata (e não interface) para servir também como token de injeção.
 */
export abstract class BlockedEmailDomainRepository {
  /**
   * Indica se o domínio está bloqueado agora.
   *
   * Domínio com remoção lógica (`deleted_at` preenchido) não bloqueia: o
   * registro permanece para que uma reinclusão o restaure (RF29).
   *
   * @param domain domínio normalizado, em minúsculas e sem `@`.
   */
  abstract isBlocked(domain: string): Promise<boolean>;

  /**
   * Página dos domínios bloqueados agora (sem os removidos), em ordem alfabética, e o total.
   */
  abstract listActive(page: {
    skip: number;
    take: number;
  }): Promise<{ items: BlockedEmailDomainRecord[]; total: number }>;

  /**
   * Bloqueia o domínio em nome do administrador. Domínio removido é restaurado, e não
   * duplicado (RF29), e passa a constar como incluído por ele.
   *
   * @param domain domínio normalizado, em minúsculas e sem `@`.
   */
  abstract add(
    domain: string,
    createdByUserId: string,
  ): Promise<AddBlockedEmailDomainResult>;

  /**
   * Remoção lógica: preenche `deleted_at`. `false` quando o domínio não existe ou já estava
   * removido.
   */
  abstract remove(id: string, removedAt: Date): Promise<boolean>;
}

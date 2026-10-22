/**
 * Tipos de dado mantidos em cache.
 *
 * O namespace separa os dados por tipo, de modo que invalidar o perfil de uma
 * empresa não derruba as evidências dela, e permite apagar tudo de um CNPJ com
 * uma única operação.
 */
export const CacheNamespace = {
  /** Perfil cadastral consolidado de uma empresa. */
  COMPANY_PROFILE: 'company-profile',

  /** Evidências normalizadas de uma empresa. */
  COMPANY_EVIDENCES: 'company-evidences',

  /** Índice e confiança por ODS de uma empresa. */
  COMPANY_SCORES: 'company-scores',
  /** Retratos sanitizados de cada cadastro CGU, separados por fonte e CNPJ. */
  CGU_CEIS: 'cgu-ceis',
  CGU_CNEP: 'cgu-cnep',
  /** Inventario sanitizado, por CNPJ e com data original. */
  GHG_INVENTORY: 'ghg-inventory',

  /**
   * Descrição oficial de uma subclasse da CNAE (IBGE). O identificador é o
   * código CNAE, e não um CNPJ: a descrição é da taxonomia, igual para toda
   * empresa.
   */
  CNAE_DESCRIPTION: 'cnae-description',
} as const;

export type CacheNamespace =
  (typeof CacheNamespace)[keyof typeof CacheNamespace];

/** Todos os namespaces declarados, na ordem de declaração. */
export const CACHE_NAMESPACES: readonly CacheNamespace[] =
  Object.values(CacheNamespace);

/**
 * Chave de uma entrada em cache.
 *
 * O identificador é o CNPJ nos dados de empresa. Não entram em chave de cache
 * dados pessoais de indivíduo (INL02).
 */
export interface CacheKey {
  namespace: CacheNamespace;
  identifier: string;
}

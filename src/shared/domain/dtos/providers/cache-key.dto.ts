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

  /** Panorama da base inteira. O identificador é fixo, e não um CNPJ. */
  COMPANY_ANALYTICS: 'company-analytics',

  /** Retratos sanitizados de cada cadastro CGU, separados por fonte e CNPJ. */
  CGU_CEIS: 'cgu-ceis',
  CGU_CNEP: 'cgu-cnep',
  /** Inventario sanitizado, por CNPJ e com data original. */
  GHG_INVENTORY: 'ghg-inventory',
  /**
   * Cadastro de organizações do Registro Público de Emissões, sincronizado uma vez
   * por dia. O identificador é fixo, e não um CNPJ: o cadastro é da fonte, igual
   * para toda empresa, e reconstruível por ela (não é fonte de verdade).
   */
  GHG_ORGANIZATIONS: 'ghg-organizations',

  /**
   * Descrição oficial de uma subclasse da CNAE (IBGE). O identificador é o
   * código CNAE, e não um CNPJ: a descrição é da taxonomia, igual para toda
   * empresa.
   */
  CNAE_DESCRIPTION: 'cnae-description',

  /**
   * Endereço de um CEP (ViaCEP). O identificador é o CEP, sem nada que ligue a consulta a uma
   * conta: o endereço é do lugar, igual para quem mora nele.
   */
  POSTAL_CODE: 'postal-code',
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

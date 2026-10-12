/**
 * Contrato de acesso ao catálogo de fontes externas.
 *
 * Classe abstrata (e não interface) para servir também como token de injeção.
 */
export abstract class DataSourceRepository {
  /**
   * Janela de validade do cache das consultas a uma fonte, em segundos.
   *
   * Devolve `null` quando a fonte não existe ou não tem janela configurada —
   * quem chama decide a reserva, porque a ausência não é erro.
   */
  abstract findCacheTtlSeconds(slug: string): Promise<number | null>;
}

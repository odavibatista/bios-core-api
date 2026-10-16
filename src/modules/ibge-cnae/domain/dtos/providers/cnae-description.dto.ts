/**
 * Descrição oficial de uma subclasse da CNAE (RF06).
 *
 * É o que o IBGE publica, na grafia dele (em maiúsculas): a taxonomia é da
 * Comissão Nacional de Classificação, e o BIOS não a reescreve.
 */
export interface CnaeDescription {
  /** Código da subclasse, 7 dígitos, sem máscara. */
  code: string;

  /** Descrição textual da atividade econômica. */
  description: string;
}

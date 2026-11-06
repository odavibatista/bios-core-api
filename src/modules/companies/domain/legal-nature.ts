/** Natureza jurídica do empresário individual, inclusive o MEI, na tabela da Receita. */
const INDIVIDUAL_ENTREPRENEUR_NATURE = '2135';

/** Compara só os dígitos: há provedores que escrevem `213-5`. */
export function isIndividualEntrepreneur(code: string): boolean {
  return code.replace(/\D/g, '') === INDIVIDUAL_ENTREPRENEUR_NATURE;
}

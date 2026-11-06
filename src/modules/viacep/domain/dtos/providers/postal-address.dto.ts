/** Endereço de um CEP, como o ViaCEP o informa, já normalizado. */
export interface PostalAddress {
  /** CEP, 8 dígitos, sem máscara. */
  postalCode: string;

  /** Logradouro. CEP geral de município não tem. */
  street: string | null;

  /** Bairro. CEP geral de município não tem. */
  neighborhood: string | null;

  /** Município, na grafia do ViaCEP. */
  city: string;

  /** Sigla da UF. */
  state: string;

  /** Código IBGE do município, com 7 dígitos. */
  cityIbgeCode: string | null;
}

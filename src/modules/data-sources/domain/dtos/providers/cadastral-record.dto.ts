import type { RegistrationStatus } from '../../cadastral-normalizers.js';

/** Atividade econômica (CNAE). */
export interface CadastralCnae {
  /** Código de 7 dígitos, sem máscara. */
  code: string;

  /** Descrição textual; vazia quando o provedor não a informa (o IBGE a completa, RF06). */
  description: string;
}

/** Endereço público da pessoa jurídica. */
export interface CadastralAddress {
  street: string | null;
  number: string | null;
  complement: string | null;
  neighborhood: string | null;
  city: string;
  /** Código IBGE do município, 7 dígitos. */
  cityIbgeCode: string | null;
  /** Sigla da UF, 2 letras maiúsculas. */
  uf: string;
  /** CEP, 8 dígitos, sem máscara. */
  zipcode: string | null;
}

/**
 * Cadastro de uma pessoa jurídica no vocabulário do BIOS, igual para qualquer
 * provedor da cadeia (BrasilAPI, OpenCNPJ, Minha Receita).
 *
 * Cada adapter lê o formato do seu provedor e entrega este — por isso trocar
 * de provedor não muda nada adiante (NFPD02). **Só carrega dado de pessoa
 * jurídica:** sócios, administradores e contatos não têm onde existir aqui
 * (INL02), então não há como um adapter os deixar escapar.
 */
export interface CadastralRecord {
  /** CNPJ canônico: 14 caracteres, sem pontuação, em maiúsculas. */
  cnpj: string;
  legalName: string;
  tradeName: string | null;

  /** Situação cadastral na Receita, no conjunto fechado do BIOS (ex.: `ATIVA`, `BAIXADA`). */
  registrationStatus: RegistrationStatus;

  /** Texto do provedor quando a situação é `NAO_RECONHECIDA`; `null` nas demais. */
  registrationStatusUnrecognized: string | null;

  /** Porte, em maiúsculas (ex.: `DEMAIS`, `MICRO EMPRESA`). */
  companySize: string | null;

  address: CadastralAddress;
  mainCnae: CadastralCnae;
  secondaryCnaes: CadastralCnae[];
}

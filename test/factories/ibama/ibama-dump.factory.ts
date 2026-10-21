import type { IbamaRecord } from '@modules/ibama/domain/dtos/providers/ibama-dump.dto.js';
import { faker } from '../../support/faker.js';
import { defineFactory } from '../factory.js';

/** Linha de um CSV do IBAMA: nome da coluna para valor. */
export type IbamaCsvRow = Record<string, string>;

/**
 * CNPJs válidos e CPFs válidos, de domínio público, para os cenários que
 * precisam distinguir pessoa jurídica de pessoa física.
 */
export const IBAMA_CNPJ = '11222333000181';
export const IBAMA_CNPJ_MASKED = '11.222.333/0001-81';
export const IBAMA_OTHER_CNPJ = '00000000000191';
export const IBAMA_CPF = '12345678909';
export const IBAMA_CPF_MASKED = '123.456.789-09';

/**
 * Colunas do auto de infração: as lidas pelo adapter e algumas que ele **não**
 * pode deixar passar (nome do autuado, texto livre, geometria).
 */
export const AUTO_INFRACAO_COLUMNS = [
  'SEQ_AUTO_INFRACAO',
  'DES_STATUS_FORMULARIO',
  'SIT_CANCELADO',
  'NUM_AUTO_INFRACAO',
  'SER_AUTO_INFRACAO',
  'TIPO_AUTO',
  'VAL_AUTO_INFRACAO',
  'DAT_HORA_AUTO_INFRACAO',
  'MUNICIPIO',
  'UF',
  'DES_AUTO_INFRACAO',
  'DES_INFRACAO',
  'TP_PESSOA_INFRATOR',
  'NUM_PESSOA_INFRATOR',
  'NOME_INFRATOR',
  'CPF_CNPJ_INFRATOR',
  'DS_WKT',
] as const;

export const TERMO_EMBARGO_COLUMNS = [
  'SEQ_TAD',
  'DES_STATUS_FORMULARIO',
  'SIT_CANCELADO',
  'NUM_TAD',
  'SER_TAD',
  'DAT_EMBARGO',
  'NUM_PESSOA_EMBARGO',
  'NOME_EMBARGADO',
  'CPF_CNPJ_EMBARGADO',
  'DES_TAD',
  'MUNICIPIO',
  'UF',
  'QTD_AREA_EMBARGADA',
  'TIPO_AREA',
  'SIT_DESEMBARGO',
  'TIPO_DESEMBARGO',
  'DAT_DESEMBARGO',
  'GEOM_AREA_EMBARGADA',
] as const;

/** Auto de infração de uma pessoa jurídica (CNPJ com máscara, como no dump). */
export const autoInfracaoRowFactory = defineFactory<IbamaCsvRow>(() => ({
  SEQ_AUTO_INFRACAO: faker.string.numeric(6),
  DES_STATUS_FORMULARIO: 'Lavrado',
  SIT_CANCELADO: 'N',
  NUM_AUTO_INFRACAO: faker.string.numeric(7),
  SER_AUTO_INFRACAO: 'E',
  TIPO_AUTO: 'Multa simples',
  VAL_AUTO_INFRACAO: `${faker.number.int({ min: 100, max: 90_000 })},00`,
  DAT_HORA_AUTO_INFRACAO: '2024-05-17 10:30:00',
  MUNICIPIO: faker.location.city(),
  UF: 'PA',
  DES_AUTO_INFRACAO: `Texto livre; com ponto e vírgula\ne quebra de linha (${faker.lorem.words(3)})`,
  DES_INFRACAO: 'Destruir floresta considerada de preservação permanente',
  TP_PESSOA_INFRATOR: 'PJ',
  NUM_PESSOA_INFRATOR: faker.string.numeric(5),
  NOME_INFRATOR: faker.company.name(),
  CPF_CNPJ_INFRATOR: IBAMA_CNPJ_MASKED,
  DS_WKT: 'POLYGON((0 0, 1 1, 1 0, 0 0))',
}));

/** Termo de embargo de uma pessoa jurídica (CNPJ só com dígitos, como no dump). */
export const termoEmbargoRowFactory = defineFactory<IbamaCsvRow>(() => ({
  SEQ_TAD: faker.string.numeric(6),
  DES_STATUS_FORMULARIO: 'Lavrado',
  SIT_CANCELADO: 'N',
  NUM_TAD: faker.string.numeric(6),
  SER_TAD: 'E',
  DAT_EMBARGO: '2023-02-10 09:15:00',
  NUM_PESSOA_EMBARGO: faker.string.numeric(5),
  NOME_EMBARGADO: faker.company.name(),
  CPF_CNPJ_EMBARGADO: IBAMA_CNPJ,
  DES_TAD: `Texto livre do termo ${faker.lorem.words(3)}`,
  MUNICIPIO: faker.location.city(),
  UF: 'MT',
  QTD_AREA_EMBARGADA: '12,5000',
  SIT_DESEMBARGO: '',
  GEOM_AREA_EMBARGADA: 'POLYGON((0 0, 1 1, 1 0, 0 0))',
}));

/** Marca de ordem de bytes (U+FEFF), escrita pelo código para não ficar invisível no fonte. */
const BYTE_ORDER_MARK = String.fromCodePoint(0xfeff);

export interface CsvOptions {
  /** Põe aspas em todos os campos, como o dump do termo de embargo faz. */
  quoteAll?: boolean;

  /** Marca de ordem de bytes no início, como no termo de embargo. */
  bom?: boolean;
}

function quote(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

/**
 * Serializa linhas no formato dos dumps do IBAMA: separador `;` e campos entre
 * aspas quando têm `;`, aspas ou quebra de linha.
 */
export function toIbamaCsv(
  columns: readonly string[],
  rows: readonly IbamaCsvRow[],
  { quoteAll = false, bom = false }: CsvOptions = {},
): string {
  const cell = (value: string) =>
    quoteAll || /[;"\r\n]/.test(value) ? quote(value) : value;
  const lines = [
    columns.map(cell).join(';'),
    ...rows.map((row) =>
      columns.map((column) => cell(row[column] ?? '')).join(';'),
    ),
  ];

  return `${bom ? BYTE_ORDER_MARK : ''}${lines.join('\n')}\n`;
}

/**
 * Registro de pessoa jurídica como o adapter o entrega (`IbamaRecord`), de um
 * auto de infração. Os testes sobrescrevem o `payload` inteiro quando precisam
 * de outras colunas.
 */
export const ibamaRecordFactory = defineFactory<IbamaRecord>(() => {
  const number = faker.string.numeric(7);

  return {
    resource: 'AUTO_INFRACAO',
    cnpj: IBAMA_CNPJ,
    reference: `${number}-E`,
    sequence: faker.string.numeric(6),
    payload: {
      SEQ_AUTO_INFRACAO: faker.string.numeric(6),
      NUM_AUTO_INFRACAO: number,
      SER_AUTO_INFRACAO: 'E',
      DES_STATUS_FORMULARIO: 'Lavrado',
      SIT_CANCELADO: 'N',
      TIPO_AUTO: 'Multa simples',
      VAL_AUTO_INFRACAO: '6932,00',
      DAT_HORA_AUTO_INFRACAO: '2024-05-17 10:30:00',
      MUNICIPIO: 'Altamira',
      UF: 'PA',
      DES_INFRACAO: 'Destruir floresta considerada de preservação permanente',
    },
  };
});

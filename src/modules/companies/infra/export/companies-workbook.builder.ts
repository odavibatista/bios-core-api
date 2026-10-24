import type { Cell, SheetData } from 'write-excel-file/node';
import writeXlsxFile from 'write-excel-file/node';

/** Índice e confiança de uma empresa em um ODS; nulos quando não há cálculo. */
export interface WorkbookOdsScore {
  score: number | null;
  confidence: number | null;
}

/** Uma empresa da lista exportada: só dados de pessoa jurídica (INL02). */
export interface WorkbookCompany {
  cnpj: string;
  legalName: string;
  tradeName: string | null;
  registrationStatus: string;
  uf: string;
  city: string;
  mainCnaeCode: string;
  mainCnaeDescription: string;

  /** Índice e confiança por número de ODS; ODS ausente fica com as células vazias. */
  scores: ReadonlyMap<number, WorkbookOdsScore>;
}

/** Nome da planilha. */
export const COMPANIES_SHEET_NAME = 'Empresas';

/** Cabeçalho das colunas cadastrais, na ordem em que saem. */
export const COMPANY_COLUMN_HEADERS = [
  'CNPJ',
  'Razão social',
  'Nome fantasia',
  'Situação cadastral',
  'UF',
  'Município',
  'CNAE principal',
  'Descrição do CNAE',
] as const;

/** Cabeçalho das duas colunas de um ODS. */
export function odsColumnHeaders(odsNumber: number): [string, string] {
  return [`ODS ${odsNumber} - Índice`, `ODS ${odsNumber} - Confiança`];
}

const COMPANY_COLUMN_WIDTHS = [18, 48, 36, 20, 6, 28, 16, 56];
const ODS_COLUMN_WIDTH = 16;
const NUMBER_FORMAT = '0.00';

/** Texto de célula: as fórmulas só existem se pedidas, então `=1+1` sai como texto. */
function text(value: string | null): Cell {
  return value === null || value === '' ? null : { value, type: String };
}

function number(value: number | null): Cell {
  return value === null ? null : { value, type: Number, format: NUMBER_FORMAT };
}

/**
 * Monta a planilha da lista de empresas (UC09, RF15) e a devolve em memória.
 *
 * Uma linha por empresa, na ordem recebida; os dados cadastrais e, em colunas separadas por
 * ODS, o índice e a confiança. Índice e confiança nunca se combinam, e o que não foi
 * calculado fica como célula vazia, e não como zero.
 */
export async function buildCompaniesWorkbook(
  companies: readonly WorkbookCompany[],
  odsNumbers: readonly number[],
): Promise<Buffer> {
  const header: Cell[] = [
    ...COMPANY_COLUMN_HEADERS,
    ...odsNumbers.flatMap(odsColumnHeaders),
  ].map((title) => ({ value: title, type: String, fontWeight: 'bold' }));

  const rows: SheetData = companies.map((company) => [
    text(company.cnpj),
    text(company.legalName),
    text(company.tradeName),
    text(company.registrationStatus),
    text(company.uf),
    text(company.city),
    text(company.mainCnaeCode),
    text(company.mainCnaeDescription),
    ...odsNumbers.flatMap((odsNumber) => {
      const score = company.scores.get(odsNumber);

      return [number(score?.score ?? null), number(score?.confidence ?? null)];
    }),
  ]);

  return writeXlsxFile([header, ...rows], {
    sheet: COMPANIES_SHEET_NAME,
    stickyRowsCount: 1,
    columns: [
      ...COMPANY_COLUMN_WIDTHS,
      ...odsNumbers.flatMap(() => [ODS_COLUMN_WIDTH, ODS_COLUMN_WIDTH]),
    ].map((width) => ({ width })),
  }).toBuffer();
}

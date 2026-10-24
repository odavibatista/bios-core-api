import { readXlsx } from '@test/support/xlsx-reader.js';
import {
  buildCompaniesWorkbook,
  COMPANIES_SHEET_NAME,
  COMPANY_COLUMN_HEADERS,
  odsColumnHeaders,
  type WorkbookCompany,
} from './companies-workbook.builder.js';

function company(overrides: Partial<WorkbookCompany> = {}): WorkbookCompany {
  return {
    cnpj: '11222333000181',
    legalName: 'ACME LTDA',
    tradeName: 'ACME TINTAS',
    registrationStatus: 'ATIVA',
    uf: 'SP',
    city: 'SÃO PAULO',
    mainCnaeCode: '6201501',
    mainCnaeDescription: 'Desenvolvimento de software',
    scores: new Map(),
    ...overrides,
  };
}

async function read(
  companies: WorkbookCompany[],
  odsNumbers: number[] = [13, 15],
) {
  return readXlsx(await buildCompaniesWorkbook(companies, odsNumbers));
}

describe('buildCompaniesWorkbook', () => {
  it('gera um arquivo XLSX (um ZIP) em memória', async () => {
    const buffer = await buildCompaniesWorkbook([company()], [13]);

    expect(buffer.subarray(0, 2).toString('latin1')).toBe('PK');
  });

  it('a planilha se chama Empresas e o cabeçalho fica fixo no topo', async () => {
    const xlsx = await read([company()]);

    expect(xlsx.sheetName).toBe(COMPANIES_SHEET_NAME);
    expect(xlsx.frozenRows).toBe(1);
  });

  it('o cabeçalho traz as colunas cadastrais e, por ODS, índice e confiança separados', async () => {
    const [header] = (await read([company()], [13, 15])).rows;

    expect(header).toEqual([
      ...COMPANY_COLUMN_HEADERS,
      'ODS 13 - Índice',
      'ODS 13 - Confiança',
      'ODS 15 - Índice',
      'ODS 15 - Confiança',
    ]);
    expect(odsColumnHeaders(15)).toEqual([
      'ODS 15 - Índice',
      'ODS 15 - Confiança',
    ]);
  });

  it('uma linha por empresa, na ordem recebida, com os dados cadastrais', async () => {
    const { rows } = await read([
      company({ cnpj: '11222333000181', legalName: 'ZEBRA' }),
      company({ cnpj: '00000000000191', legalName: 'ABELHA' }),
    ]);

    expect(rows).toHaveLength(3);
    expect(rows[1].slice(0, 8)).toEqual([
      '11222333000181',
      'ZEBRA',
      'ACME TINTAS',
      'ATIVA',
      'SP',
      'SÃO PAULO',
      '6201501',
      'Desenvolvimento de software',
    ]);
    expect(rows[2][1]).toBe('ABELHA');
  });

  it('índice e confiança de cada ODS vão para as suas colunas', async () => {
    const { rows } = await read([
      company({
        scores: new Map([
          [13, { score: 60, confidence: 0.2 }],
          [15, { score: -45.5, confidence: 0.8 }],
        ]),
      }),
    ]);

    expect(rows[1].slice(8)).toEqual([60, 0.2, -45.5, 0.8]);
  });

  it('o que não foi calculado fica vazio, e não zero', async () => {
    const { rows } = await read([
      company({
        scores: new Map([
          [13, { score: null, confidence: 0 }],
          // ODS 15 sem retrato nenhum
        ]),
      }),
    ]);

    expect(rows[1].slice(8)).toEqual([null, 0, null, null]);
  });

  it('o índice zero é gravado como zero', async () => {
    const { rows } = await read([
      company({ scores: new Map([[13, { score: 0, confidence: 0.5 }]]) }),
    ]);

    expect(rows[1][8]).toBe(0);
  });

  it('o nome fantasia ausente deixa a célula vazia', async () => {
    const { rows } = await read([company({ tradeName: null })]);

    expect(rows[1][2]).toBeNull();
  });

  it('o CNPJ alfanumérico e com zeros à esquerda sai como texto, sem virar número', async () => {
    const { rows } = await read([
      company({ cnpj: '00000000000191' }),
      company({ cnpj: '12ABC34501DE35' }),
    ]);

    expect(rows[1][0]).toBe('00000000000191');
    expect(rows[2][0]).toBe('12ABC34501DE35');
  });

  it('texto que parece fórmula sai como texto, e nenhuma célula tem fórmula', async () => {
    const xlsx = await read([
      company({
        legalName: '=HYPERLINK("http://x.example","a")',
        tradeName: '@SOMA(A1)',
      }),
    ]);

    expect(xlsx.rows[1][1]).toBe('=HYPERLINK("http://x.example","a")');
    expect(xlsx.rows[1][2]).toBe('@SOMA(A1)');
    expect(xlsx.hasFormulas).toBe(false);
  });

  it('preserva acentos e caracteres especiais do XML', async () => {
    const { rows } = await read([
      company({ legalName: 'AÇÃO & CIA <LTDA> "X"', city: 'SÃO JOÃO D’OESTE' }),
    ]);

    expect(rows[1][1]).toBe('AÇÃO & CIA <LTDA> "X"');
    expect(rows[1][5]).toBe('SÃO JOÃO D’OESTE');
  });

  it('sem empresas, só o cabeçalho', async () => {
    const { rows } = await read([]);

    expect(rows).toHaveLength(1);
  });

  it('sem ODS ativo, só as colunas cadastrais', async () => {
    const { rows } = await read([company()], []);

    expect(rows[0]).toEqual([...COMPANY_COLUMN_HEADERS]);
    expect(rows[1]).toHaveLength(COMPANY_COLUMN_HEADERS.length);
  });

  it('formata índice e confiança com duas casas, sem alterar o valor gravado', async () => {
    const buffer = await buildCompaniesWorkbook(
      [
        company({
          scores: new Map([[13, { score: 12.3456, confidence: 0.5 }]]),
        }),
      ],
      [13],
    );
    const xlsx = readXlsx(buffer);

    expect(xlsx.rows[1][8]).toBe(12.3456);
    expect(xlsx.allText).toContain('formatCode="0.00"');
  });
});

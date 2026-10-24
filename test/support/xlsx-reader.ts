import { strFromU8, unzipSync } from 'fflate';

/** Valor de uma célula lida: texto, número ou vazio. */
export type XlsxCell = string | number | null;

/** O que os testes precisam saber de um arquivo XLSX. */
export interface XlsxContent {
  /** Nome da primeira planilha. */
  sheetName: string;

  /** Linhas da primeira planilha; a coluna vazia vem como `null`. */
  rows: XlsxCell[][];

  /** Linhas congeladas no topo (cabeçalho fixo). */
  frozenRows: number;

  /** Alguma célula traz fórmula (`<f>`)? */
  hasFormulas: boolean;

  /** Todo o texto do arquivo, para procurar o que não pode estar nele. */
  allText: string;
}

function decode(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** Índice de coluna (0 a partir de A) de uma referência como `C12`. */
function columnIndex(reference: string): number {
  const letters = /^[A-Z]+/.exec(reference)?.[0] ?? '';

  return (
    [...letters].reduce(
      (index, letter) => index * 26 + letter.charCodeAt(0) - 64,
      0,
    ) - 1
  );
}

/**
 * Lê um XLSX sem depender de uma biblioteca de planilhas: abre o ZIP e interpreta o XML da
 * primeira planilha e a tabela de textos. Basta para conferir o que a exportação grava.
 */
export function readXlsx(content: Uint8Array): XlsxContent {
  const files = unzipSync(content);
  const text = (path: string) => {
    const data = files[path];

    if (!data) throw new Error(`O arquivo XLSX não tem ${path}.`);

    return strFromU8(data);
  };

  const sharedStrings = [
    ...text('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g),
  ].map(([, item]) =>
    decode(
      [...item.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)]
        .map(([, part]) => part)
        .join(''),
    ),
  );
  const sheet = text('xl/worksheets/sheet1.xml');
  const rows: XlsxCell[][] = [];

  for (const [, rowXml] of sheet.matchAll(/<row [^>]*>([\s\S]*?)<\/row>/g)) {
    const row: XlsxCell[] = [];

    for (const [, attributes, inner] of rowXml.matchAll(
      /<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g,
    )) {
      const reference = /r="([A-Z]+\d+)"/.exec(attributes)?.[1] ?? '';
      const type = /t="([a-zA-Z]+)"/.exec(attributes)?.[1];
      const raw = /<v>([\s\S]*?)<\/v>/.exec(inner ?? '')?.[1];
      let value: XlsxCell = null;

      if (raw !== undefined) {
        value = type === 's' ? sharedStrings[Number(raw)] : Number(raw);
      }

      row[columnIndex(reference)] = value;
    }

    rows.push(Array.from(row, (cell) => cell ?? null));
  }

  // O XML omite as células vazias do fim da linha: todas passam a ter a largura da maior.
  const width = Math.max(0, ...rows.map((row) => row.length));
  const padded = rows.map((row) =>
    Array.from({ length: width }, (_, column) => row[column] ?? null),
  );

  return {
    sheetName:
      /<sheet [^>]*name="([^"]*)"/.exec(text('xl/workbook.xml'))?.[1] ?? '',
    rows: padded,
    frozenRows: Number(/ySplit="(\d+)"/.exec(sheet)?.[1] ?? 0),
    hasFormulas: /<f[ >]/.test(sheet),
    allText: Object.values(files)
      .map((data) => strFromU8(data))
      .join('\n'),
  };
}

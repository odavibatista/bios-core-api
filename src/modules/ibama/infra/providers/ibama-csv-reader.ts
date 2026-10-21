import { createReadStream } from 'node:fs';
import type { Readable } from 'node:stream';
import { parse } from 'csv-parse';
import { type Entry, open, type ZipFile } from 'yauzl';
import { IbamaDumpFormatError } from '../../domain/dtos/providers/ibama-dump.dto.js';
import type { IbamaContainer } from '../../domain/ibama-resource.js';

/** Maior soma dos CSVs de um `.zip` depois de descompactados (hoje, cerca de 720 MB). */
export const MAX_UNCOMPRESSED_BYTES = 2 * 1024 * 1024 * 1024;

/** Chamado a cada linha que o CSV não consegue ler (aspas ou colunas fora do formato). */
export interface CsvReadHooks {
  onMalformedRow(): void;
}

export type CsvRow = Record<string, string>;

/**
 * Linhas de um CSV do IBAMA, lidas em fluxo.
 *
 * O formato dos dumps: separador `;`, primeira linha com os nomes das colunas,
 * campos entre aspas quando têm quebra de linha (o texto livre tem), e, no termo
 * de embargo, uma marca de ordem de bytes (BOM) no início. A leitura é do
 * arquivo inteiro sem carregá-lo na memória: o auto de infração passa de 700 MB.
 *
 * Uma linha malformada não derruba o dump: é pulada e contada. Se o problema é o
 * arquivo todo, a validação das colunas (quem consome) acusa.
 */
export async function* readCsvRows(
  source: Readable,
  hooks: CsvReadHooks,
): AsyncGenerator<CsvRow> {
  const parser = parse({
    delimiter: ';',
    columns: true,
    bom: true,
    relax_quotes: true,
    skip_records_with_error: true,
    // O tipo da biblioteca exige retorno `undefined`, e não `void`.
    on_skip: () => {
      hooks.onMalformedRow();

      return undefined;
    },
  });

  // `pipe` não repassa erro de leitura: sem isto o parser ficaria esperando.
  source.on('error', (error) => parser.destroy(error));
  source.pipe(parser);

  try {
    for await (const row of parser) yield row as CsvRow;
  } finally {
    source.destroy();
  }
}

function openZip(path: string): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    // `autoClose: false`: os CSVs são abertos depois de listados.
    open(path, { lazyEntries: true, autoClose: false }, (error, zip) =>
      error ? reject(error) : resolve(zip),
    );
  });
}

function listCsvEntries(zip: ZipFile): Promise<Entry[]> {
  return new Promise((resolve, reject) => {
    const entries: Entry[] = [];

    zip.on('entry', (entry: Entry) => {
      // Diretórios terminam em `/`; só os CSVs interessam.
      if (!entry.fileName.endsWith('/') && /\.csv$/i.test(entry.fileName)) {
        entries.push(entry);
      }

      zip.readEntry();
    });
    zip.once('end', () => resolve(entries));
    zip.once('error', reject);
    zip.readEntry();
  });
}

function openEntry(zip: ZipFile, entry: Entry): Promise<Readable> {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (error, stream) =>
      error ? reject(error) : resolve(stream),
    );
  });
}

/**
 * Linhas de todos os CSVs de um `.zip`, um arquivo depois do outro.
 *
 * Os CSVs são lidos direto do `.zip`, sem extrair para o disco. O tamanho
 * declarado de cada um é somado antes de começar e recusado acima do limite; o
 * leitor do `.zip` confere que cada arquivo tem de fato o tamanho declarado, o
 * que impede uma bomba de descompressão de burlar a soma.
 */
async function* readZipRows(
  path: string,
  hooks: CsvReadHooks,
): AsyncGenerator<CsvRow> {
  const zip = await openZip(path).catch((error: unknown) => {
    throw new IbamaDumpFormatError(
      `não foi possível abrir o .zip (${error instanceof Error ? error.message : String(error)})`,
    );
  });

  try {
    const entries = await listCsvEntries(zip);

    if (entries.length === 0) {
      throw new IbamaDumpFormatError('o .zip não tem nenhum CSV');
    }

    const total = entries.reduce(
      (sum, { uncompressedSize }) => sum + uncompressedSize,
      0,
    );

    if (total > MAX_UNCOMPRESSED_BYTES) {
      throw new IbamaDumpFormatError(
        `o conteúdo descompactado (${total} bytes) passa do limite de ${MAX_UNCOMPRESSED_BYTES}`,
      );
    }

    for (const entry of entries) {
      yield* readCsvRows(await openEntry(zip, entry), hooks);
    }
  } finally {
    zip.close();
  }
}

/**
 * Linhas de um dump do IBAMA, qualquer que seja o empacotamento.
 *
 * Cada arquivo do dump é lido com o próprio cabeçalho (cada linha chega como
 * objeto de coluna para valor), e quem consome confere as colunas em cada linha.
 */
export function readIbamaRows(
  path: string,
  container: IbamaContainer,
  hooks: CsvReadHooks,
): AsyncGenerator<CsvRow> {
  return container === 'ZIP_OF_CSV'
    ? readZipRows(path, hooks)
    : readCsvRows(createReadStream(path), hooks);
}

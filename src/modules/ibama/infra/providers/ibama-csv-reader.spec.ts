import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AUTO_INFRACAO_COLUMNS,
  autoInfracaoRowFactory,
  termoEmbargoRowFactory,
  TERMO_EMBARGO_COLUMNS,
  toIbamaCsv,
} from '@test/factories/ibama/ibama-dump.factory.js';
import { faker } from '@test/support/faker.js';
import { buildZip } from '@test/support/zip.js';
import { IbamaDumpFormatError } from '../../domain/dtos/providers/ibama-dump.dto.js';
import {
  type CsvRow,
  MAX_UNCOMPRESSED_BYTES,
  readIbamaRows,
} from './ibama-csv-reader.js';

describe('readIbamaRows', () => {
  let directory: string;
  const malformed = vi.fn();

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'bios-ibama-spec-'));
    malformed.mockReset();
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  async function readAll(
    path: string,
    container: 'CSV' | 'ZIP_OF_CSV',
  ): Promise<CsvRow[]> {
    const rows: CsvRow[] = [];

    for await (const row of readIbamaRows(path, container, {
      onMalformedRow: malformed,
    })) {
      rows.push(row);
    }

    return rows;
  }

  async function write(name: string, content: string | Buffer) {
    const path = join(directory, name);
    await writeFile(path, content);

    return path;
  }

  describe('CSV', () => {
    it('lê as linhas como objetos de coluna para valor', async () => {
      const [first, second] = termoEmbargoRowFactory.buildMany(2);
      const path = await write(
        'embargo.csv',
        toIbamaCsv(TERMO_EMBARGO_COLUMNS, [first, second]),
      );

      const rows = await readAll(path, 'CSV');

      expect(rows).toHaveLength(2);
      expect(rows[0].NUM_TAD).toBe(first.NUM_TAD);
      expect(rows[1].CPF_CNPJ_EMBARGADO).toBe(second.CPF_CNPJ_EMBARGADO);
      expect(Object.keys(rows[0])).toEqual([...TERMO_EMBARGO_COLUMNS]);
    });

    it('ignora a marca de ordem de bytes e lê campos todos entre aspas', async () => {
      const row = termoEmbargoRowFactory.build();
      const path = await write(
        'embargo.csv',
        toIbamaCsv(TERMO_EMBARGO_COLUMNS, [row], { quoteAll: true, bom: true }),
      );

      const [read] = await readAll(path, 'CSV');

      expect(Object.keys(read)[0]).toBe('SEQ_TAD');
      expect(read.SEQ_TAD).toBe(row.SEQ_TAD);
    });

    it('lê campo com ponto e vírgula, aspas e quebra de linha dentro das aspas', async () => {
      const text = 'a; b "citado"\nsegunda linha';
      const path = await write(
        'autos.csv',
        toIbamaCsv(AUTO_INFRACAO_COLUMNS, [
          autoInfracaoRowFactory.build({ DES_AUTO_INFRACAO: text }),
        ]),
      );

      const [row] = await readAll(path, 'CSV');

      expect(row.DES_AUTO_INFRACAO).toBe(text);
    });

    it('acentos chegam inteiros (UTF-8)', async () => {
      const path = await write(
        'autos.csv',
        toIbamaCsv(AUTO_INFRACAO_COLUMNS, [
          autoInfracaoRowFactory.build({ MUNICIPIO: 'São Félix do Xingu' }),
        ]),
      );

      const [row] = await readAll(path, 'CSV');

      expect(row.MUNICIPIO).toBe('São Félix do Xingu');
    });

    it('pula a linha com colunas a mais ou a menos e a conta, sem derrubar o dump', async () => {
      // Sem texto de várias linhas: a quebra de linha é o que separa os registros.
      const [good, other] = autoInfracaoRowFactory.buildMany(2, {
        DES_AUTO_INFRACAO: 'texto de uma linha só',
      });
      const csv = toIbamaCsv(AUTO_INFRACAO_COLUMNS, [good, other]).split('\n');
      csv.splice(2, 0, 'so;duas;colunas');
      const path = await write('autos.csv', csv.join('\n'));

      const rows = await readAll(path, 'CSV');

      expect(rows.map((row) => row.NUM_AUTO_INFRACAO)).toEqual([
        good.NUM_AUTO_INFRACAO,
        other.NUM_AUTO_INFRACAO,
      ]);
      expect(malformed).toHaveBeenCalledOnce();
    });

    it('arquivo só com o cabeçalho não tem linhas', async () => {
      const path = await write(
        'autos.csv',
        toIbamaCsv(AUTO_INFRACAO_COLUMNS, []),
      );

      await expect(readAll(path, 'CSV')).resolves.toEqual([]);
    });

    it('propaga a falha de leitura (arquivo que não existe)', async () => {
      await expect(
        readAll(join(directory, 'nao-existe.csv'), 'CSV'),
      ).rejects.toThrow(/ENOENT/);
    });
  });

  describe('ZIP de CSVs', () => {
    it('lê todos os CSVs, um depois do outro, cada um com o seu cabeçalho', async () => {
      const [a, b, c] = autoInfracaoRowFactory.buildMany(3);
      const path = await write(
        'autos.zip',
        buildZip([
          {
            name: 'auto_infracao_2024.csv',
            content: toIbamaCsv(AUTO_INFRACAO_COLUMNS, [a, b]),
          },
          {
            name: 'auto_infracao_2025.csv',
            content: toIbamaCsv(AUTO_INFRACAO_COLUMNS, [c]),
            method: 'store',
          },
        ]),
      );

      const rows = await readAll(path, 'ZIP_OF_CSV');

      expect(rows.map((row) => row.NUM_AUTO_INFRACAO)).toEqual([
        a.NUM_AUTO_INFRACAO,
        b.NUM_AUTO_INFRACAO,
        c.NUM_AUTO_INFRACAO,
      ]);
    });

    it('ignora o que não é CSV e os diretórios', async () => {
      const row = autoInfracaoRowFactory.build();
      const path = await write(
        'autos.zip',
        buildZip([
          { name: 'LEIA-ME.txt', content: 'não é dado' },
          { name: 'pasta/', content: '' },
          {
            name: 'pasta/auto_infracao_2024.CSV',
            content: toIbamaCsv(AUTO_INFRACAO_COLUMNS, [row]),
          },
        ]),
      );

      const rows = await readAll(path, 'ZIP_OF_CSV');

      expect(rows).toHaveLength(1);
      expect(rows[0].NUM_AUTO_INFRACAO).toBe(row.NUM_AUTO_INFRACAO);
    });

    it('arquivo grande o bastante para vir em vários pedaços é lido por inteiro', async () => {
      const rows = autoInfracaoRowFactory.buildMany(2_000);
      const path = await write(
        'autos.zip',
        buildZip([
          {
            name: 'auto_infracao_2024.csv',
            content: toIbamaCsv(AUTO_INFRACAO_COLUMNS, rows),
          },
        ]),
      );

      await expect(readAll(path, 'ZIP_OF_CSV')).resolves.toHaveLength(2_000);
    });

    it('recusa o .zip sem nenhum CSV', async () => {
      const path = await write(
        'autos.zip',
        buildZip([{ name: 'LEIA-ME.txt', content: faker.lorem.sentence() }]),
      );

      await expect(readAll(path, 'ZIP_OF_CSV')).rejects.toThrow(
        new IbamaDumpFormatError('o .zip não tem nenhum CSV'),
      );
    });

    it('recusa o arquivo que não é um .zip', async () => {
      const path = await write('autos.zip', 'isto não é um zip de verdade');

      await expect(readAll(path, 'ZIP_OF_CSV')).rejects.toBeInstanceOf(
        IbamaDumpFormatError,
      );
    });

    it('recusa o .zip cujo conteúdo descompactado passa do limite, sem lê-lo', async () => {
      const path = await write(
        'autos.zip',
        buildZip([
          {
            name: 'auto_infracao_2024.csv',
            content: toIbamaCsv(AUTO_INFRACAO_COLUMNS, []),
            declaredUncompressedSize: MAX_UNCOMPRESSED_BYTES + 1,
          },
        ]),
      );

      await expect(readAll(path, 'ZIP_OF_CSV')).rejects.toThrow(
        /passa do limite/,
      );
    });

    it('a soma dos CSVs é que conta para o limite', async () => {
      const half = Math.floor(MAX_UNCOMPRESSED_BYTES / 2) + 1;
      const csv = toIbamaCsv(AUTO_INFRACAO_COLUMNS, []);
      const path = await write(
        'autos.zip',
        buildZip([
          {
            name: 'a.csv',
            content: csv,
            declaredUncompressedSize: half,
          },
          {
            name: 'b.csv',
            content: csv,
            declaredUncompressedSize: half,
          },
        ]),
      );

      await expect(readAll(path, 'ZIP_OF_CSV')).rejects.toThrow(
        /passa do limite/,
      );
    });

    it('recusa o arquivo cujo tamanho real difere do declarado (bomba de descompressão)', async () => {
      const content = toIbamaCsv(
        AUTO_INFRACAO_COLUMNS,
        autoInfracaoRowFactory.buildMany(5),
      );
      const path = await write(
        'autos.zip',
        buildZip([
          {
            name: 'a.csv',
            content,
            declaredUncompressedSize: 10,
          },
        ]),
      );

      await expect(readAll(path, 'ZIP_OF_CSV')).rejects.toThrow();
    });
  });
});

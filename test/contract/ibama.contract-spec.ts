import { createWriteStream } from 'node:fs';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  mapIbamaRow,
  requiredColumns,
} from '@modules/ibama/domain/ibama-record.mapper.js';
import {
  IBAMA_RESOURCES,
  type IbamaResource,
} from '@modules/ibama/domain/ibama-resource.js';
import { MAX_DUMP_BYTES } from '@modules/ibama/infra/providers/ibama.data-source.js';
import { readIbamaRows } from '@modules/ibama/infra/providers/ibama-csv-reader.js';
import { joinUrl, seededBaseUrl } from './support.js';

/** Linhas lidas de cada dump: o bastante para achar pessoa jurídica, sem varrer 700 MB. */
const SAMPLE_ROWS = 50_000;
const DOWNLOAD_TIMEOUT_MS = 540_000;

describe.each(Object.keys(IBAMA_RESOURCES) as IbamaResource[])(
  'contrato do IBAMA: %s',
  (resource) => {
    const definition = IBAMA_RESOURCES[resource];
    let directory: string;
    let file: string;
    let response: Response;

    beforeAll(async () => {
      directory = await mkdtemp(join(tmpdir(), 'bios-contract-ibama-'));
      file = join(directory, 'dump');
      response = await fetch(
        joinUrl(seededBaseUrl('IBAMA'), definition.segments),
        { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) },
      );

      if (response.status === 200 && response.body) {
        await pipeline(
          Readable.fromWeb(response.body as never),
          createWriteStream(file),
        );
      }
    });

    afterAll(() => rm(directory, { recursive: true, force: true }));

    it('responde 200 com um arquivo, e não uma página de erro', () => {
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type') ?? '').not.toMatch(/html/i);
    });

    it('entrega o tamanho dentro do que o adapter aceita', async () => {
      const { size } = await stat(file);

      expect(size).toBeGreaterThan(1024 * 1024);
      expect(size).toBeLessThan(MAX_DUMP_BYTES);
    });

    it('tem o cabeçalho com as colunas que o adapter lê', async () => {
      let columns: readonly string[] = [];
      const rows = readIbamaRows(file, definition.container, {
        onHeader: (header) => {
          columns = header;
        },
        onMalformedRow: () => undefined,
      });

      await rows.next();
      await rows.return(undefined);

      expect(columns).toEqual(
        expect.arrayContaining([
          ...requiredColumns(definition),
          ...definition.payloadColumns,
        ]),
      );
    });

    it('traz registros de pessoa jurídica que o adapter consegue ler', async () => {
      let read = 0;
      let kept = 0;
      const rows = readIbamaRows(file, definition.container, {
        onMalformedRow: () => undefined,
      });

      for await (const row of rows) {
        const result = mapIbamaRow(definition, row);

        if (result.kind === 'RECORD') {
          kept += 1;
          expect(result.record.cnpj).toMatch(/^[A-Z0-9]{14}$/);
          expect(result.record.reference).not.toBe('');
        }

        read += 1;
        if (read >= SAMPLE_ROWS) break;
      }

      expect(read).toBeGreaterThan(0);
      expect(kept).toBeGreaterThan(0);
    });
  },
);

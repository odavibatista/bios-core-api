import { rm } from 'node:fs/promises';
import type { SourceDownloadedFile } from '@modules/data-sources/domain/providers/source-http-client.provider.js';
import {
  type IbamaDump,
  IbamaDumpFormatError,
  type IbamaReadStats,
  type IbamaRecord,
} from '../../domain/dtos/providers/ibama-dump.dto.js';
import { IbamaDiscardReason } from '../../domain/ibama-document.js';
import {
  mapIbamaRow,
  requiredColumns,
} from '../../domain/ibama-record.mapper.js';
import type {
  IbamaResource,
  IbamaResourceDefinition,
} from '../../domain/ibama-resource.js';
import { readIbamaRows } from './ibama-csv-reader.js';

function emptyStats(): IbamaReadStats {
  return {
    rows: 0,
    kept: 0,
    discarded: {
      [IbamaDiscardReason.PESSOA_FISICA]: 0,
      [IbamaDiscardReason.SEM_DOCUMENTO]: 0,
      [IbamaDiscardReason.DOCUMENTO_INVALIDO]: 0,
      [IbamaDiscardReason.REGISTRO_MALFORMADO]: 0,
    },
  };
}

/**
 * Dump do IBAMA já baixado para o disco, lido em fluxo.
 *
 * Cada chamada de `records()` relê o arquivo do começo, o que permite a quem
 * ingere conferir o `checksum` primeiro e só então decidir ler. As contagens
 * ficam em `stats`, reiniciadas a cada leitura.
 */
export class FileIbamaDump implements IbamaDump {
  stats: IbamaReadStats = emptyStats();

  constructor(
    private readonly definition: IbamaResourceDefinition,
    private readonly file: SourceDownloadedFile,
    private readonly directory: string,
  ) {}

  get resource(): IbamaResource {
    return this.definition.resource;
  }

  get checksum(): string {
    return this.file.checksum;
  }

  get bytes(): number {
    return this.file.bytes;
  }

  async *records(): AsyncGenerator<IbamaRecord> {
    const stats = emptyStats();
    this.stats = stats;
    const required = requiredColumns(this.definition);

    const rows = readIbamaRows(this.file.path, this.definition.container, {
      onHeader: (columns) => {
        const missing = required.filter((column) => !columns.includes(column));
        if (missing.length > 0) {
          throw new IbamaDumpFormatError(
            `coluna(s) ausente(s): ${missing.join(', ')}`,
          );
        }
      },
      onMalformedRow: () => {
        stats.rows += 1;
        stats.discarded[IbamaDiscardReason.REGISTRO_MALFORMADO] += 1;
      },
    });

    for await (const row of rows) {
      stats.rows += 1;
      const result = mapIbamaRow(this.definition, row);

      if (result.kind === 'DISCARD') {
        stats.discarded[result.reason] += 1;

        continue;
      }

      stats.kept += 1;

      yield result.record;
    }
  }

  async dispose(): Promise<void> {
    await rm(this.directory, { recursive: true, force: true });
  }
}

import { existsSync } from 'node:fs';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AUTO_INFRACAO_COLUMNS,
  autoInfracaoRowFactory,
  IBAMA_CNPJ,
  IBAMA_CPF,
  IBAMA_CPF_MASKED,
  IBAMA_OTHER_CNPJ,
  termoEmbargoRowFactory,
  TERMO_EMBARGO_COLUMNS,
  toIbamaCsv,
} from '@test/factories/ibama/ibama-dump.factory.js';
import { faker } from '@test/support/faker.js';
import { buildZip } from '@test/support/zip.js';
import {
  IbamaDumpFormatError,
  type IbamaRecord,
} from '../../domain/dtos/providers/ibama-dump.dto.js';
import {
  IBAMA_RESOURCES,
  IbamaResource,
  type IbamaResourceDefinition,
} from '../../domain/ibama-resource.js';
import { FileIbamaDump } from './file-ibama-dump.js';

const AUTO = IBAMA_RESOURCES[IbamaResource.AUTO_INFRACAO];
const EMBARGO = IBAMA_RESOURCES[IbamaResource.TERMO_EMBARGO];

describe('FileIbamaDump', () => {
  const checksum = faker.string.hexadecimal({
    length: 64,
    prefix: '',
    casing: 'lower',
  });

  /**
   * Grava o dump em uma pasta temporária. O auto de infração é um `.zip`: texto
   * de CSV passado para ele vai empacotado em um `.zip` de um arquivo só.
   */
  async function create(
    definition: IbamaResourceDefinition,
    content: string | Buffer,
  ): Promise<{ dump: FileIbamaDump; directory: string }> {
    const directory = await mkdtemp(join(tmpdir(), 'bios-ibama-spec-'));
    const path = join(directory, 'dump');
    const body =
      definition.container === 'ZIP_OF_CSV' && typeof content === 'string'
        ? buildZip([{ name: 'auto_infracao_2024.csv', content }])
        : content;
    await writeFile(path, body);

    return {
      directory,
      dump: new FileIbamaDump(
        definition,
        { path, bytes: body.length, checksum },
        directory,
      ),
    };
  }

  async function collect(dump: FileIbamaDump): Promise<IbamaRecord[]> {
    const records: IbamaRecord[] = [];

    for await (const record of dump.records()) records.push(record);

    return records;
  }

  const disposables: FileIbamaDump[] = [];

  afterEach(async () => {
    await Promise.all(disposables.splice(0).map((dump) => dump.dispose()));
  });

  async function open(
    definition: IbamaResourceDefinition,
    content: string | Buffer,
  ) {
    const { dump } = await create(definition, content);
    disposables.push(dump);

    return dump;
  }

  it('expõe o recurso, o checksum e o tamanho do arquivo baixado', async () => {
    const dump = await open(
      EMBARGO,
      toIbamaCsv(TERMO_EMBARGO_COLUMNS, [termoEmbargoRowFactory.build()]),
    );

    expect(dump.resource).toBe(IbamaResource.TERMO_EMBARGO);
    expect(dump.checksum).toBe(checksum);
    expect(dump.bytes).toBeGreaterThan(0);
  });

  describe('descarte de pessoa física (INL02)', () => {
    const rows = [
      autoInfracaoRowFactory.build({ NUM_AUTO_INFRACAO: '1' }),
      autoInfracaoRowFactory.build({
        NUM_AUTO_INFRACAO: '2',
        TP_PESSOA_INFRATOR: 'PF',
        CPF_CNPJ_INFRATOR: IBAMA_CPF_MASKED,
      }),
      autoInfracaoRowFactory.build({
        NUM_AUTO_INFRACAO: '3',
        CPF_CNPJ_INFRATOR: IBAMA_OTHER_CNPJ,
      }),
      autoInfracaoRowFactory.build({
        NUM_AUTO_INFRACAO: '4',
        TP_PESSOA_INFRATOR: 'PJ',
        CPF_CNPJ_INFRATOR: IBAMA_CPF,
      }),
      autoInfracaoRowFactory.build({
        NUM_AUTO_INFRACAO: '5',
        TP_PESSOA_INFRATOR: '',
        CPF_CNPJ_INFRATOR: '',
      }),
      autoInfracaoRowFactory.build({
        NUM_AUTO_INFRACAO: '6',
        CPF_CNPJ_INFRATOR: '9999999',
      }),
    ];

    it('só entrega os registros de pessoa jurídica', async () => {
      const dump = await open(AUTO, toIbamaCsv(AUTO_INFRACAO_COLUMNS, rows));

      const records = await collect(dump);

      expect(records.map(({ reference }) => reference)).toEqual(['1-E', '3-E']);
      expect(records.map(({ cnpj }) => cnpj)).toEqual([
        IBAMA_CNPJ,
        IBAMA_OTHER_CNPJ,
      ]);
    });

    it('nenhum CPF aparece em nenhum registro entregue', async () => {
      const dump = await open(AUTO, toIbamaCsv(AUTO_INFRACAO_COLUMNS, rows));

      const records = await collect(dump);
      const serialized = JSON.stringify(records);

      expect(serialized).not.toContain(IBAMA_CPF);
      expect(serialized).not.toContain('123.456.789');
    });

    it('conta as linhas lidas, entregues e descartadas por motivo', async () => {
      const dump = await open(AUTO, toIbamaCsv(AUTO_INFRACAO_COLUMNS, rows));

      await collect(dump);

      expect(dump.stats).toEqual({
        rows: 6,
        kept: 2,
        discarded: {
          PESSOA_FISICA: 2,
          SEM_DOCUMENTO: 1,
          DOCUMENTO_INVALIDO: 1,
          REGISTRO_MALFORMADO: 0,
        },
      });
    });

    it('a linha malformada do CSV entra na contagem de descartadas', async () => {
      // Sem texto de várias linhas: a quebra de linha é o que separa os registros.
      const singleLine = rows.map((row) => ({
        ...row,
        DES_AUTO_INFRACAO: 'texto de uma linha só',
      }));
      const lines = toIbamaCsv(AUTO_INFRACAO_COLUMNS, singleLine).split('\n');
      lines.splice(2, 0, 'linha;quebrada');
      const dump = await open(AUTO, lines.join('\n'));

      await collect(dump);

      expect(dump.stats.discarded.REGISTRO_MALFORMADO).toBe(1);
      expect(dump.stats.rows).toBe(7);
      expect(dump.stats.kept).toBe(2);
    });

    it('vale também para o termo de embargo, que não traz o tipo de pessoa', async () => {
      const dump = await open(
        EMBARGO,
        toIbamaCsv(
          TERMO_EMBARGO_COLUMNS,
          [
            termoEmbargoRowFactory.build({ NUM_TAD: 'A' }),
            termoEmbargoRowFactory.build({
              NUM_TAD: 'B',
              CPF_CNPJ_EMBARGADO: IBAMA_CPF,
            }),
          ],
          { quoteAll: true, bom: true },
        ),
      );

      const records = await collect(dump);

      expect(records.map(({ reference }) => reference)).toEqual(['A-E']);
      expect(dump.stats.discarded.PESSOA_FISICA).toBe(1);
    });
  });

  it('lê os CSVs de um .zip como um dump só', async () => {
    const dump = await open(
      AUTO,
      buildZip([
        {
          name: 'auto_infracao_2023.csv',
          content: toIbamaCsv(AUTO_INFRACAO_COLUMNS, [
            autoInfracaoRowFactory.build({ NUM_AUTO_INFRACAO: '10' }),
          ]),
        },
        {
          name: 'auto_infracao_2024.csv',
          content: toIbamaCsv(AUTO_INFRACAO_COLUMNS, [
            autoInfracaoRowFactory.build({ NUM_AUTO_INFRACAO: '20' }),
            autoInfracaoRowFactory.build({
              NUM_AUTO_INFRACAO: '21',
              TP_PESSOA_INFRATOR: 'PF',
              CPF_CNPJ_INFRATOR: IBAMA_CPF_MASKED,
            }),
          ]),
        },
      ]),
    );

    const records = await collect(dump);

    expect(records.map(({ reference }) => reference)).toEqual(['10-E', '20-E']);
    expect(dump.stats).toMatchObject({ rows: 3, kept: 2 });
  });

  it('pode ser lido de novo, e as contagens recomeçam', async () => {
    const dump = await open(
      EMBARGO,
      toIbamaCsv(TERMO_EMBARGO_COLUMNS, termoEmbargoRowFactory.buildMany(3)),
    );

    await collect(dump);
    const second = await collect(dump);

    expect(second).toHaveLength(3);
    expect(dump.stats).toMatchObject({ rows: 3, kept: 3 });
  });

  describe('formato do dump mudou', () => {
    it.each([
      ['o documento', 'CPF_CNPJ_EMBARGADO'],
      ['o número do termo', 'NUM_TAD'],
      ['a série', 'SER_TAD'],
      ['o identificador interno', 'SEQ_TAD'],
    ])('lança quando falta a coluna de %s', async (_nome, missing) => {
      const columns = TERMO_EMBARGO_COLUMNS.filter(
        (column) => column !== missing,
      );
      const dump = await open(
        EMBARGO,
        toIbamaCsv(columns, [termoEmbargoRowFactory.build()]),
      );

      await expect(collect(dump)).rejects.toThrow(
        new IbamaDumpFormatError(`coluna(s) ausente(s): ${missing}`),
      );
    });

    it('sem a coluna do tipo de pessoa, o auto de infração é recusado, e não aceito sem o rótulo', async () => {
      const columns = AUTO_INFRACAO_COLUMNS.filter(
        (column) => column !== 'TP_PESSOA_INFRATOR',
      );
      const dump = await open(
        AUTO,
        toIbamaCsv(columns, [autoInfracaoRowFactory.build()]),
      );

      await expect(collect(dump)).rejects.toBeInstanceOf(IbamaDumpFormatError);
    });

    it('não entrega registro algum antes de acusar a coluna que falta', async () => {
      const columns = TERMO_EMBARGO_COLUMNS.filter(
        (column) => column !== 'NUM_TAD',
      );
      const dump = await open(
        EMBARGO,
        toIbamaCsv(columns, termoEmbargoRowFactory.buildMany(3)),
      );
      const delivered: IbamaRecord[] = [];

      await expect(async () => {
        for await (const record of dump.records()) delivered.push(record);
      }).rejects.toBeInstanceOf(IbamaDumpFormatError);

      expect(delivered).toHaveLength(0);
    });
  });

  it('dispose apaga a pasta do dump e pode ser repetido', async () => {
    const { dump, directory } = await create(
      EMBARGO,
      toIbamaCsv(TERMO_EMBARGO_COLUMNS, [termoEmbargoRowFactory.build()]),
    );

    expect(existsSync(directory)).toBe(true);

    await dump.dispose();
    await dump.dispose();

    expect(existsSync(directory)).toBe(false);
  });
  it.each([AUTO, EMBARGO])(
    'cabeçalho válido sem registros em $resource confirma dump vazio',
    async (definition) => {
      const columns =
        definition === AUTO ? AUTO_INFRACAO_COLUMNS : TERMO_EMBARGO_COLUMNS;
      const dump = await open(definition, toIbamaCsv(columns, []));
      await expect(collect(dump)).resolves.toEqual([]);
      expect(dump.stats.rows).toBe(0);
    },
  );
  it.each([AUTO, EMBARGO])(
    'cabeçalho incompleto sem registros em $resource não confirma ausência',
    async (definition) => {
      const columns =
        definition === AUTO ? AUTO_INFRACAO_COLUMNS : TERMO_EMBARGO_COLUMNS;
      const dump = await open(
        definition,
        toIbamaCsv(
          columns.filter((column) => column !== definition.documentColumn),
          [],
        ),
      );
      await expect(collect(dump)).rejects.toBeInstanceOf(IbamaDumpFormatError);
    },
  );
  it.each([AUTO, EMBARGO])(
    'arquivo vazio em $resource não confirma ausência',
    async (definition) => {
      const dump = await open(definition, '');
      await expect(collect(dump)).rejects.toThrow('não tem cabeçalho');
    },
  );
  it('valida até CSV vazio com cabeçalho incorreto dentro de ZIP que já entregou registros', async () => {
    const dump = await open(
      AUTO,
      buildZip([
        {
          name: 'primeiro.csv',
          content: toIbamaCsv(AUTO_INFRACAO_COLUMNS, [
            autoInfracaoRowFactory.build(),
          ]),
        },
        { name: 'segundo.csv', content: toIbamaCsv(['COLUNA_INVALIDA'], []) },
      ]),
    );
    await expect(collect(dump)).rejects.toBeInstanceOf(IbamaDumpFormatError);
  });
});

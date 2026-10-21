import {
  AUTO_INFRACAO_COLUMNS,
  autoInfracaoRowFactory,
  IBAMA_CNPJ,
  IBAMA_CNPJ_MASKED,
  IBAMA_CPF_MASKED,
  termoEmbargoRowFactory,
} from '@test/factories/ibama/ibama-dump.factory.js';
import { IbamaDiscardReason } from './ibama-document.js';
import { mapIbamaRow, requiredColumns } from './ibama-record.mapper.js';
import { IBAMA_RESOURCES, IbamaResource } from './ibama-resource.js';

const AUTO = IBAMA_RESOURCES[IbamaResource.AUTO_INFRACAO];
const EMBARGO = IBAMA_RESOURCES[IbamaResource.TERMO_EMBARGO];

describe('mapIbamaRow', () => {
  describe('auto de infração', () => {
    it('vira um registro com o CNPJ canônico, a referência e o identificador interno', () => {
      const row = autoInfracaoRowFactory.build({
        SEQ_AUTO_INFRACAO: '691556',
        NUM_AUTO_INFRACAO: '1092',
        SER_AUTO_INFRACAO: 'A',
        CPF_CNPJ_INFRATOR: IBAMA_CNPJ_MASKED,
      });

      const result = mapIbamaRow(AUTO, row);

      expect(result).toMatchObject({
        kind: 'RECORD',
        record: {
          resource: IbamaResource.AUTO_INFRACAO,
          cnpj: IBAMA_CNPJ,
          reference: '1092-A',
          sequence: '691556',
        },
      });
    });

    it('leva só as colunas permitidas, sem nome do autuado, texto livre nem geometria', () => {
      const row = autoInfracaoRowFactory.build();

      const result = mapIbamaRow(AUTO, row);

      expect(result.kind).toBe('RECORD');
      const { payload } = (result as { record: { payload: object } }).record;
      expect(Object.keys(payload).sort()).toEqual(
        AUTO.payloadColumns
          .filter((column) => row[column] !== undefined && row[column] !== '')
          .sort(),
      );
      for (const forbidden of [
        'NOME_INFRATOR',
        'NUM_PESSOA_INFRATOR',
        'DES_AUTO_INFRACAO',
        'DS_WKT',
        'CPF_CNPJ_INFRATOR',
      ]) {
        expect(payload).not.toHaveProperty(forbidden);
      }
    });

    it('o nome do autuado não aparece em lugar nenhum do registro', () => {
      const row = autoInfracaoRowFactory.build({
        NOME_INFRATOR: 'NOME SECRETO DA PESSOA',
      });

      const result = mapIbamaRow(AUTO, row);

      expect(JSON.stringify(result)).not.toContain('NOME SECRETO');
    });

    it('apara os espaços do dump e omite os campos vazios', () => {
      const row = autoInfracaoRowFactory.build({
        MUNICIPIO: '  Altamira   ',
        TIPO_AUTO: '',
        UF: ' PA ',
      });

      const result = mapIbamaRow(AUTO, row) as {
        record: { payload: Record<string, string> };
      };

      expect(result.record.payload.MUNICIPIO).toBe('Altamira');
      expect(result.record.payload.UF).toBe('PA');
      expect(result.record.payload).not.toHaveProperty('TIPO_AUTO');
    });

    it('documento novo: número alfanumérico e série vazia viram só o número', () => {
      const row = autoInfracaoRowFactory.build({
        SEQ_AUTO_INFRACAO: '',
        NUM_AUTO_INFRACAO: 'VW0EGDEQ',
        SER_AUTO_INFRACAO: '',
      });

      const result = mapIbamaRow(AUTO, row);

      expect(result).toMatchObject({
        kind: 'RECORD',
        record: { reference: 'VW0EGDEQ', sequence: null },
      });
    });

    it('pessoa física (CPF) é descartada, e o CPF não vai a lugar algum', () => {
      const row = autoInfracaoRowFactory.build({
        TP_PESSOA_INFRATOR: 'PF',
        CPF_CNPJ_INFRATOR: IBAMA_CPF_MASKED,
      });

      const result = mapIbamaRow(AUTO, row);

      expect(result).toEqual({
        kind: 'DISCARD',
        reason: IbamaDiscardReason.PESSOA_FISICA,
      });
      expect(JSON.stringify(result)).not.toContain('123.456');
    });

    it('rotulada PJ com um CPF no documento também é descartada', () => {
      const row = autoInfracaoRowFactory.build({
        TP_PESSOA_INFRATOR: 'PJ',
        CPF_CNPJ_INFRATOR: IBAMA_CPF_MASKED,
      });

      expect(mapIbamaRow(AUTO, row)).toEqual({
        kind: 'DISCARD',
        reason: IbamaDiscardReason.PESSOA_FISICA,
      });
    });

    it.each([
      [IbamaDiscardReason.SEM_DOCUMENTO, ''],
      [IbamaDiscardReason.DOCUMENTO_INVALIDO, '9999999'],
    ])('descarta com o motivo %s', (reason, document) => {
      const row = autoInfracaoRowFactory.build({ CPF_CNPJ_INFRATOR: document });

      expect(mapIbamaRow(AUTO, row)).toEqual({ kind: 'DISCARD', reason });
    });

    it('sem número do documento, é registro malformado', () => {
      const row = autoInfracaoRowFactory.build({
        NUM_AUTO_INFRACAO: '  ',
        SER_AUTO_INFRACAO: '',
      });

      expect(mapIbamaRow(AUTO, row)).toEqual({
        kind: 'DISCARD',
        reason: IbamaDiscardReason.REGISTRO_MALFORMADO,
      });
    });
  });

  describe('termo de embargo', () => {
    it('não tem tipo de pessoa: o documento decide', () => {
      expect(mapIbamaRow(EMBARGO, termoEmbargoRowFactory.build()).kind).toBe(
        'RECORD',
      );
      expect(
        mapIbamaRow(
          EMBARGO,
          termoEmbargoRowFactory.build({ CPF_CNPJ_EMBARGADO: '12345678909' }),
        ),
      ).toEqual({ kind: 'DISCARD', reason: IbamaDiscardReason.PESSOA_FISICA });
    });

    it('vira um registro com a referência do termo e sem o nome do embargado', () => {
      const row = termoEmbargoRowFactory.build({
        NUM_TAD: 'O8NIPPN1',
        SER_TAD: '',
        SEQ_TAD: '',
        NOME_EMBARGADO: 'NOME SECRETO DA PESSOA',
      });

      const result = mapIbamaRow(EMBARGO, row);

      expect(result).toMatchObject({
        kind: 'RECORD',
        record: {
          resource: IbamaResource.TERMO_EMBARGO,
          cnpj: IBAMA_CNPJ,
          reference: 'O8NIPPN1',
          sequence: null,
        },
      });
      expect(JSON.stringify(result)).not.toContain('NOME SECRETO');
      expect(JSON.stringify(result)).not.toContain('POLYGON');
    });
  });

  it('uma coluna ausente na linha vale como vazia, sem lançar', () => {
    expect(mapIbamaRow(AUTO, {})).toEqual({
      kind: 'DISCARD',
      reason: IbamaDiscardReason.SEM_DOCUMENTO,
    });
  });
});

describe('requiredColumns', () => {
  it('o auto de infração exige o documento, o tipo de pessoa, a referência e o identificador', () => {
    expect([...requiredColumns(AUTO)].sort()).toEqual(
      [
        'CPF_CNPJ_INFRATOR',
        'NUM_AUTO_INFRACAO',
        'SEQ_AUTO_INFRACAO',
        'SER_AUTO_INFRACAO',
        'TP_PESSOA_INFRATOR',
      ].sort(),
    );
  });

  it('o termo de embargo não exige tipo de pessoa, que ele não tem', () => {
    expect(requiredColumns(EMBARGO)).not.toContain('TP_PESSOA_INFRATOR');
    expect(requiredColumns(EMBARGO)).toContain('CPF_CNPJ_EMBARGADO');
  });

  it('as colunas de teste do auto cobrem as exigidas', () => {
    for (const column of requiredColumns(AUTO)) {
      expect(AUTO_INFRACAO_COLUMNS).toContain(column);
    }
  });
});

describe('definições dos recursos', () => {
  it.each(Object.values(IBAMA_RESOURCES))(
    '$resource: nenhuma coluna do payload é o documento nem o nome da pessoa',
    ({ payloadColumns, documentColumn }) => {
      expect(payloadColumns).not.toContain(documentColumn);
      for (const column of payloadColumns) {
        expect(column).not.toMatch(
          /^NOME_|^CPF_|^NUM_PESSOA_|^DS_WKT|^GEOM_|WKT/,
        );
      }
    },
  );
});

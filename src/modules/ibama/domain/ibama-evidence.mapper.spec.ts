import type { EvidenceBatchEntry } from '@modules/evidences/domain/dtos/providers/evidence-batch.dto.js';
import {
  IBAMA_CNPJ,
  ibamaRecordFactory,
} from '@test/factories/ibama/ibama-dump.factory.js';
import type { IbamaRecord } from './dtos/providers/ibama-dump.dto.js';
import {
  IBAMA_DATASET_URLS,
  isAnnulled,
  toEvidenceEntry,
} from './ibama-evidence.mapper.js';
import { IbamaResource } from './ibama-resource.js';

function autoWith(
  payload: Record<string, string>,
  over: Partial<IbamaRecord> = {},
) {
  const base = ibamaRecordFactory.build();

  return { ...base, ...over, payload: { ...base.payload, ...payload } };
}

function embargo(
  payload: Record<string, string>,
  over: Partial<IbamaRecord> = {},
) {
  return ibamaRecordFactory.build({
    resource: IbamaResource.TERMO_EMBARGO,
    reference: 'AAAA1111',
    sequence: null,
    payload: {
      NUM_TAD: 'AAAA1111',
      DES_STATUS_FORMULARIO: 'Lavrado',
      SIT_CANCELADO: 'N',
      DAT_EMBARGO: '2023-02-10 09:15:00',
      TIPO_AREA: 'Desmatamento',
      QTD_AREA_EMBARGADA: '12,5000',
      MUNICIPIO: 'Lages',
      UF: 'SC',
      NUM_PROCESSO: '02001.000123/2023-11',
      ...payload,
    },
    ...over,
  });
}

function entryOf(record: IbamaRecord): EvidenceBatchEntry {
  const entry = toEvidenceEntry(record);

  if (entry === null) throw new Error('registro anulado');

  return entry;
}

describe('isAnnulled', () => {
  it.each([
    ['cancelado (flag S)', { SIT_CANCELADO: 'S' }],
    ['cancelado (flag s)', { SIT_CANCELADO: 's' }],
    ['status Cancelado', { DES_STATUS_FORMULARIO: 'Cancelado' }],
    ['status Excluído', { DES_STATUS_FORMULARIO: 'Excluído' }],
    ['status Excluido, sem acento', { DES_STATUS_FORMULARIO: 'Excluido' }],
    ['status em minúsculas', { DES_STATUS_FORMULARIO: 'cancelado' }],
    [
      'substituído por outro',
      { DES_STATUS_FORMULARIO: 'Substituído por outro' },
    ],
    ['excluído no AIe', { DES_STATUS_FORMULARIO_AIE: 'Excluído' }],
  ])('%s é anulado', (_caso, payload) => {
    expect(isAnnulled(autoWith(payload))).toBe(true);
  });

  it.each([
    ['Lavrado', { DES_STATUS_FORMULARIO: 'Lavrado' }],
    ['sem status (7 mil autos o têm vazio)', { DES_STATUS_FORMULARIO: '' }],
    ['impresso no AIe', { DES_STATUS_FORMULARIO_AIE: 'Impresso' }],
    ['em execução no AIe', { DES_STATUS_FORMULARIO_AIE: 'Em execução' }],
    ['flag N', { SIT_CANCELADO: 'N' }],
  ])('%s não é anulado', (_caso, payload) => {
    expect(isAnnulled(autoWith(payload))).toBe(false);
  });

  it('sem nenhuma das colunas de situação, não é anulado', () => {
    const record = ibamaRecordFactory.build({ payload: { UF: 'PA' } });

    expect(isAnnulled(record)).toBe(false);
  });
});

describe('toEvidenceEntry', () => {
  it('registro anulado não vira evidência', () => {
    expect(toEvidenceEntry(autoWith({ SIT_CANCELADO: 'S' }))).toBeNull();
    expect(
      toEvidenceEntry(embargo({ DES_STATUS_FORMULARIO: 'Cancelado' })),
    ).toBeNull();
  });

  describe('auto de infração', () => {
    const record = ibamaRecordFactory.build({
      reference: '1092-A',
      sequence: '691556',
      payload: {
        SEQ_AUTO_INFRACAO: '691556',
        NUM_AUTO_INFRACAO: '1092',
        SER_AUTO_INFRACAO: 'A',
        DES_STATUS_FORMULARIO: 'Lavrado',
        TIPO_AUTO: 'Multa simples',
        TIPO_INFRACAO: 'Flora',
        COD_INFRACAO: '409999',
        DES_INFRACAO: 'Infração da Flora',
        GRAVIDADE_INFRACAO: 'Grave',
        VAL_AUTO_INFRACAO: '6932,00',
        QT_AREA: '12,5000',
        DS_BIOMAS_ATINGIDOS: 'Amazônia',
        DAT_HORA_AUTO_INFRACAO: '1980-02-08 00:00:00',
        DT_FATO_INFRACIONAL: '1980-02-01 00:00:00',
        COD_MUNICIPIO: '2304400',
        MUNICIPIO: 'FORTALEZA',
        UF: 'CE',
        NUM_PROCESSO: '02007000101198021',
        NU_PROCESSO_FORMATADO: '02007.000101/1980-21',
      },
    });

    it('leva o CNPJ, a referência pública e o link do conjunto de dados', () => {
      const { cnpj, finding } = entryOf(record);

      expect(cnpj).toBe(IBAMA_CNPJ);
      expect(finding).toMatchObject({
        reference: '1092-A',
        url: IBAMA_DATASET_URLS.AUTO_INFRACAO,
      });
    });

    it('a identidade é o identificador interno, com o prefixo do recurso', () => {
      expect(entryOf(record).finding.identity).toBe('AI-691556');
    });

    it('sem identificador interno (documento novo), a identidade é a referência', () => {
      const novo = ibamaRecordFactory.build({
        reference: 'VW0EGDEQ',
        sequence: null,
      });

      expect(entryOf(novo).finding.identity).toBe('AI-VW0EGDEQ');
    });

    it('resume o auto em português, com o valor em reais e o local', () => {
      expect(entryOf(record).finding.summary).toBe(
        'Multa simples: Infração da Flora — R$ 6.932,00 (FORTALEZA/CE)',
      );
    });

    it('a data de publicação é o dia do auto', () => {
      expect(entryOf(record).finding.publishedAt?.toISOString()).toBe(
        '1980-02-08T00:00:00.000Z',
      );
    });

    it('os detalhes trazem valores já convertidos', () => {
      expect(entryOf(record).finding.details).toEqual({
        resource: 'AUTO_INFRACAO',
        notice_type: 'Multa simples',
        infraction_type: 'Flora',
        infraction_code: '409999',
        infraction_description: 'Infração da Flora',
        severity: 'Grave',
        fine_amount: 6932,
        area_hectares: 12.5,
        biomes: 'Amazônia',
        municipality: 'FORTALEZA',
        municipality_code: '2304400',
        uf: 'CE',
        process_number: '02007.000101/1980-21',
        status: 'Lavrado',
        fact_date: '1980-02-01',
      });
    });

    it('o registro bruto é o do adapter, com o recurso, e é uma cópia', () => {
      const { raw } = entryOf(record);

      expect(raw).toEqual({
        resource: 'AUTO_INFRACAO',
        payload: record.payload,
      });
      expect((raw as { payload: object }).payload).not.toBe(record.payload);
    });

    it('o que o dump não informou fica de fora dos detalhes, e o resumo se adapta', () => {
      const entry = entryOf(
        ibamaRecordFactory.build({
          payload: { SEQ_AUTO_INFRACAO: '1', NUM_AUTO_INFRACAO: '1' },
        }),
      );

      expect(entry.finding.summary).toBe('Auto de infração');
      expect(entry.finding.details).toEqual({ resource: 'AUTO_INFRACAO' });
      expect(entry.finding.publishedAt).toBeNull();
    });

    it('sem valor de multa (advertência), o resumo não inventa um', () => {
      const entry = entryOf(
        autoWith({
          TIPO_AUTO: 'Advertência',
          VAL_AUTO_INFRACAO: '',
          DES_INFRACAO: 'Deixar de averbar',
          MUNICIPIO: 'Altamira',
          UF: 'PA',
        }),
      );

      expect(entry.finding.summary).toBe(
        'Advertência: Deixar de averbar (Altamira/PA)',
      );
    });

    it.each([
      [{ MUNICIPIO: 'Altamira', UF: '' }, ' (Altamira)'],
      [{ MUNICIPIO: '', UF: 'PA' }, ' (PA)'],
      [{ MUNICIPIO: '', UF: '' }, ''],
    ])('local incompleto %o no resumo', (local, shown) => {
      const { summary } = entryOf(
        autoWith({
          ...local,
          VAL_AUTO_INFRACAO: '',
          DES_INFRACAO: '',
          TIPO_AUTO: 'Multa simples',
        }),
      ).finding;

      expect(summary).toBe(`Multa simples${shown}`);
    });

    it('não leva dado do autuado nem texto livre', () => {
      const entry = entryOf(
        autoWith({
          NOME_INFRATOR: 'NOME SECRETO',
          DES_AUTO_INFRACAO: 'texto livre com 123.456.789-09',
        }),
      );

      expect(JSON.stringify(entry)).not.toContain('NOME SECRETO');
      expect(JSON.stringify(entry)).not.toContain('123.456.789');
    });
  });

  describe('termo de embargo', () => {
    it('a identidade usa o prefixo do termo, para não colidir com a de um auto', () => {
      const termo = embargo({}, { sequence: '691556' });
      const auto = ibamaRecordFactory.build({ sequence: '691556' });

      expect(entryOf(termo).finding.identity).toBe('TE-691556');
      expect(entryOf(auto).finding.identity).toBe('AI-691556');
    });

    it('documento novo, sem identificador interno: a identidade é o número', () => {
      expect(entryOf(embargo({})).finding.identity).toBe('TE-AAAA1111');
    });

    it('resume o termo ativo, com o tipo e a área', () => {
      const entry = entryOf(embargo({}));

      expect(entry.finding.summary).toBe(
        'Termo de embargo — Desmatamento — 12,5 ha (Lages/SC)',
      );
      expect(entry.finding.url).toBe(IBAMA_DATASET_URLS.TERMO_EMBARGO);
      expect(entry.finding.publishedAt?.toISOString()).toBe(
        '2023-02-10T00:00:00.000Z',
      );
    });

    it('o embargo suspenso continua sendo evidência, marcado como desembargado', () => {
      const entry = entryOf(
        embargo({
          SIT_DESEMBARGO: 'S',
          DAT_DESEMBARGO: '2024-03-01 10:00:00',
          TIPO_DESEMBARGO: 'Administrativo',
        }),
      );

      expect(entry.finding.summary).toBe(
        'Termo de embargo — Desmatamento — 12,5 ha (Lages/SC) — desembargado em 01/03/2024',
      );
      expect(entry.finding.details).toMatchObject({
        lifted: true,
        lifted_at: '2024-03-01',
        lift_type: 'Administrativo',
      });
    });

    it('desembargado sem data: marcado, sem inventar a data', () => {
      const entry = entryOf(embargo({ SIT_DESEMBARGO: 'S' }));

      expect(entry.finding.summary).toMatch(/ — desembargado$/);
      expect(entry.finding.details).toMatchObject({ lifted: true });
      expect(entry.finding.details).not.toHaveProperty('lifted_at');
    });

    it('embargo ativo: lifted falso e sem data de desembargo', () => {
      const { details } = entryOf(embargo({})).finding;

      expect(details).toMatchObject({ lifted: false });
      expect(details).not.toHaveProperty('lifted_at');
    });

    it('traz o auto de infração de origem e o processo nos detalhes', () => {
      const { details } = entryOf(
        embargo({ NUM_AUTO_INFRACAO: 'R82XWYPH', DETER_PRODES: 'Deter' }),
      ).finding;

      expect(details).toMatchObject({
        resource: 'TERMO_EMBARGO',
        infraction_notice: 'R82XWYPH',
        process_number: '02001.000123/2023-11',
        deter_prodes: 'Deter',
        area_hectares: 12.5,
      });
    });

    it('sem área nem tipo, o resumo é só "Termo de embargo" mais o local', () => {
      const entry = entryOf(embargo({ TIPO_AREA: '', QTD_AREA_EMBARGADA: '' }));

      expect(entry.finding.summary).toBe('Termo de embargo (Lages/SC)');
    });
  });
});

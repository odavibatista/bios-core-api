import {
  IBAMA_CNPJ,
  IBAMA_CNPJ_MASKED,
  IBAMA_CPF,
  IBAMA_CPF_MASKED,
} from '@test/factories/ibama/ibama-dump.factory.js';
import { classifyIbamaDocument, IbamaDiscardReason } from './ibama-document.js';

describe('classifyIbamaDocument', () => {
  describe('pessoa jurídica: entra', () => {
    it.each([
      ['CNPJ com máscara', IBAMA_CNPJ_MASKED, 'PJ'],
      ['CNPJ só com dígitos', IBAMA_CNPJ, 'PJ'],
      [
        'CNPJ com espaços nas pontas (o dump os deixa)',
        ` ${IBAMA_CNPJ} `,
        'PJ',
      ],
      ['CNPJ sem o tipo de pessoa (termo de embargo)', IBAMA_CNPJ, undefined],
      ['CNPJ com o tipo vazio', IBAMA_CNPJ_MASKED, ''],
      ['CNPJ alfanumérico', '12.ABC.345/01DE-35', 'PJ'],
    ])('%s', (_caso, document, personType) => {
      const verdict = classifyIbamaDocument(document, personType);

      expect(verdict.kind).toBe('CNPJ');
    });

    it('devolve o CNPJ na forma canônica', () => {
      expect(classifyIbamaDocument(IBAMA_CNPJ_MASKED, 'PJ')).toEqual({
        kind: 'CNPJ',
        cnpj: IBAMA_CNPJ,
      });
      expect(classifyIbamaDocument('12.abc.345/01de-35')).toEqual({
        kind: 'CNPJ',
        cnpj: '12ABC34501DE35',
      });
    });
  });

  describe('pessoa física: é descartada (INL02)', () => {
    it.each([
      ['rotulada PF, CPF com máscara', IBAMA_CPF_MASKED, 'PF'],
      ['rotulada PF, CPF só com dígitos', IBAMA_CPF, 'PF'],
      [
        'sem rótulo, CPF só com dígitos (termo de embargo)',
        IBAMA_CPF,
        undefined,
      ],
      ['sem rótulo, CPF com máscara', IBAMA_CPF_MASKED, ''],
      [
        'rotulada PJ, mas o documento é um CPF com máscara',
        IBAMA_CPF_MASKED,
        'PJ',
      ],
      ['rotulada PJ, mas o documento é um CPF só com dígitos', IBAMA_CPF, 'PJ'],
      ['CPF com espaços de preenchimento', `${IBAMA_CPF}   `, undefined],
    ])('%s', (_caso, document, personType) => {
      expect(classifyIbamaDocument(document, personType)).toEqual({
        kind: 'DISCARD',
        reason: IbamaDiscardReason.PESSOA_FISICA,
      });
    });

    it.each(['PF', 'pf', ' Pf '])(
      'o rótulo "%s" descarta mesmo com um documento que parece CNPJ',
      (personType) => {
        expect(classifyIbamaDocument(IBAMA_CNPJ_MASKED, personType)).toEqual({
          kind: 'DISCARD',
          reason: IbamaDiscardReason.PESSOA_FISICA,
        });
      },
    );
  });

  describe('sem documento aproveitável: descartado à parte', () => {
    it.each(['', '   ', '\t'])('documento ausente ("%s")', (document) => {
      expect(classifyIbamaDocument(document, 'PJ')).toEqual({
        kind: 'DISCARD',
        reason: IbamaDiscardReason.SEM_DOCUMENTO,
      });
    });

    it.each([
      ['CNPJ com dígito verificador errado', '11222333000182'],
      ['sequência de um caractere só', '00000000000000'],
      ['número curto de outro tipo', '9999999'],
      ['nove dígitos', '123456789'],
      ['treze dígitos', '1122233300018'],
      ['texto qualquer', 'não informado'],
    ])('%s', (_caso, document) => {
      expect(classifyIbamaDocument(document, 'PJ')).toEqual({
        kind: 'DISCARD',
        reason: IbamaDiscardReason.DOCUMENTO_INVALIDO,
      });
    });
  });
});

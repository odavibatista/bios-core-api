import { ibgeCnaeSubclassFactory } from '@test/factories/data-sources/ibge-cnae.factory.js';
import { readCnaeDescription } from './ibge-cnae.mapper.js';

const CODE = '6201501';

describe('readCnaeDescription (IBGE)', () => {
  describe('resposta com a subclasse pedida', () => {
    it('lê a descrição de uma subclasse em forma de objeto', () => {
      expect(
        readCnaeDescription(ibgeCnaeSubclassFactory.build(), CODE),
      ).toEqual({
        kind: 'FOUND',
        value: {
          code: CODE,
          description:
            'DESENVOLVIMENTO DE PROGRAMAS DE COMPUTADOR SOB ENCOMENDA',
        },
      });
    });

    it('lê a descrição de uma subclasse em forma de lista', () => {
      expect(
        readCnaeDescription([ibgeCnaeSubclassFactory.build()], CODE),
      ).toMatchObject({ kind: 'FOUND', value: { code: CODE } });
    });

    it('acha a subclasse certa numa lista com várias', () => {
      const other = ibgeCnaeSubclassFactory.build({
        id: '6202300',
        descricao: 'OUTRA ATIVIDADE',
      });

      expect(
        readCnaeDescription([other, ibgeCnaeSubclassFactory.build()], CODE),
      ).toMatchObject({
        kind: 'FOUND',
        value: {
          description:
            'DESENVOLVIMENTO DE PROGRAMAS DE COMPUTADOR SOB ENCOMENDA',
        },
      });
    });

    it('aceita o id como número e recupera os zeros iniciais', () => {
      expect(
        readCnaeDescription(
          { id: 111301, descricao: 'CULTIVO DE ARROZ' },
          '0111301',
        ),
      ).toEqual({
        kind: 'FOUND',
        value: { code: '0111301', description: 'CULTIVO DE ARROZ' },
      });
    });

    it('descarta os espaços nas bordas da descrição', () => {
      expect(
        readCnaeDescription({ id: CODE, descricao: '  ATIVIDADE  ' }, CODE),
      ).toMatchObject({ value: { description: 'ATIVIDADE' } });
    });

    it('só a descrição da subclasse é lida: a hierarquia e as notas ficam de fora', () => {
      const lookup = readCnaeDescription(ibgeCnaeSubclassFactory.build(), CODE);

      expect(JSON.stringify(lookup)).not.toContain('INFORMAÇÃO E COMUNICAÇÃO');
      expect(JSON.stringify(lookup)).not.toContain('APLICATIVO INFORMÁTICO');
      expect(JSON.stringify(lookup)).not.toContain('compreende');
    });
  });

  describe('subclasse ausente', () => {
    it.each([
      ['lista vazia', []],
      ['lista de outros códigos', [{ id: '6202300', descricao: 'OUTRA' }]],
      ['objeto de outro código', { id: '6202300', descricao: 'OUTRA' }],
    ])('%s: o código não existe na taxonomia', (_case, body) => {
      expect(readCnaeDescription(body, CODE)).toEqual({ kind: 'ABSENT' });
    });

    it('nunca devolve a descrição de outra atividade', () => {
      const lookup = readCnaeDescription(
        { id: '6202300', descricao: 'DESCRIÇÃO DE OUTRA ATIVIDADE' },
        CODE,
      );

      expect(JSON.stringify(lookup)).not.toContain('OUTRA ATIVIDADE');
    });
  });

  describe('resposta inválida', () => {
    it.each([
      ['texto', 'manutenção'],
      ['null', null],
      ['número', 7],
      ['objeto sem id', { descricao: 'X' }],
      ['lista com item inválido', [{ id: CODE }, 'x']],
    ])('recusa %s', (_case, body) => {
      expect(readCnaeDescription(body, CODE)).toEqual({ kind: 'INVALID' });
    });

    it.each([
      ['sem descrição', { id: CODE }],
      ['com descrição vazia', { id: CODE, descricao: '   ' }],
      ['com descrição nula', { id: CODE, descricao: null }],
    ])(
      'subclasse %s é inválida: sem texto não há o que entregar',
      (_case, body) => {
        expect(readCnaeDescription(body, CODE)).toEqual({ kind: 'INVALID' });
      },
    );
  });
});

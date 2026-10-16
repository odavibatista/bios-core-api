import { openCnpjFactory } from '@test/factories/data-sources/opencnpj-cnpj.factory.js';
import { toCadastralRecord } from './opencnpj-cnpj.mapper.js';

const CNPJ = '11222333000181';

describe('toCadastralRecord (OpenCNPJ)', () => {
  const map = (overrides: Record<string, unknown> = {}) =>
    toCadastralRecord({ ...openCnpjFactory.build(), ...overrides }, CNPJ);

  describe('resposta completa', () => {
    it('converte para o cadastro do BIOS, com as descrições da lista de CNAEs', () => {
      const body = openCnpjFactory.build({
        razao_social: 'ACME SERVICOS LTDA',
        nome_fantasia: 'ACME',
      });

      expect(toCadastralRecord(body, CNPJ)).toEqual({
        cnpj: CNPJ,
        legalName: 'ACME SERVICOS LTDA',
        tradeName: 'ACME',
        registrationStatus: 'ATIVA',
        companySize: 'DEMAIS',
        address: {
          street: 'AVENIDA PAULISTA',
          number: '1578',
          complement: 'ANDAR 12',
          neighborhood: 'BELA VISTA',
          city: 'SAO PAULO',
          cityIbgeCode: null,
          uf: 'SP',
          zipcode: '01310200',
        },
        mainCnae: {
          code: '6201501',
          description:
            'Desenvolvimento de programas de computador sob encomenda',
        },
        secondaryCnaes: [
          {
            code: '6202300',
            description:
              'Desenvolvimento e licenciamento de programas de computador customizáveis',
          },
          {
            code: '6311900',
            description:
              'Tratamento de dados, provedores de serviços de aplicação',
          },
        ],
      });
    });

    it('não informa o código IBGE: o codigo_municipio do provedor é o da Receita', () => {
      expect(
        map({ codigo_municipio: '7107' })?.address.cityIbgeCode,
      ).toBeNull();
    });
  });

  describe('dado de pessoa física (INL02)', () => {
    it('não deixa o quadro societário, nem contatos, chegarem ao cadastro', () => {
      const record = map();
      const text = JSON.stringify(record);

      expect(record).not.toHaveProperty('QSA');
      expect(text).not.toContain('MARIA APARECIDA');
      expect(text).not.toContain('JOAO CARLOS');
      expect(text).not.toContain('***123456**');
      expect(text).not.toContain('33334444');
      expect(text).not.toContain('@');
    });

    it('o cadastro só tem os campos do contrato', () => {
      expect(Object.keys(map() ?? {}).sort()).toEqual([
        'address',
        'cnpj',
        'companySize',
        'legalName',
        'mainCnae',
        'registrationStatus',
        'secondaryCnaes',
        'tradeName',
      ]);
    });

    it('recusa o registro anonimizado: dados mascarados não são cadastro', () => {
      expect(map({ lgpd_anonimizado: true })).toBeNull();
    });

    it('aceita o registro explicitamente não anonimizado ou sem a marca', () => {
      expect(map({ lgpd_anonimizado: false })).not.toBeNull();
      expect(map({ lgpd_anonimizado: undefined })).not.toBeNull();
      expect(map({ lgpd_anonimizado: null })).not.toBeNull();
    });
  });

  describe('CNPJ da resposta', () => {
    it('aceita o CNPJ com máscara, em qualquer caixa', () => {
      expect(
        toCadastralRecord(
          openCnpjFactory.build({ cnpj: '11.222.333/0001-81' }),
          CNPJ,
        ),
      ).not.toBeNull();
      expect(
        toCadastralRecord(
          openCnpjFactory.build({ cnpj: '12abc34501de35' }),
          '12ABC34501DE35',
        ),
      ).not.toBeNull();
    });

    it('recusa a resposta de outro CNPJ', () => {
      expect(map({ cnpj: '00000000000191' })).toBeNull();
    });
  });

  describe('campos obrigatórios', () => {
    it.each([
      'razao_social',
      'situacao_cadastral',
      'cnae_principal',
      'municipio',
      'uf',
    ])('recusa a resposta sem %s', (field) => {
      expect(map({ [field]: null })).toBeNull();
      expect(map({ [field]: undefined })).toBeNull();
      expect(map({ [field]: '' })).toBeNull();
    });

    it('recusa CNAE principal zerado', () => {
      expect(map({ cnae_principal: '0000000' })).toBeNull();
    });

    it('recusa UF que não é uma sigla', () => {
      expect(map({ uf: 'SAO PAULO' })).toBeNull();
    });

    it.each([
      ['não é objeto', 'texto'],
      ['é null', null],
      ['é lista', []],
      ['não tem CNPJ', {}],
    ])('recusa o corpo que %s', (_case, body) => {
      expect(toCadastralRecord(body, CNPJ)).toBeNull();
    });
  });

  describe('campos opcionais', () => {
    it('situação e porte vêm na grafia do BIOS', () => {
      expect(
        map({ situacao_cadastral: 'Baixada', porte_empresa: 'Micro Empresa' }),
      ).toMatchObject({
        registrationStatus: 'BAIXADA',
        companySize: 'MICRO EMPRESA',
      });
      expect(map({ porte_empresa: 'Empresa de Pequeno Porte' })).toMatchObject({
        companySize: 'EMPRESA DE PEQUENO PORTE',
      });
    });

    it('sem nome fantasia ou porte, é null', () => {
      expect(map({ nome_fantasia: '', porte_empresa: '' })).toMatchObject({
        tradeName: null,
        companySize: null,
      });
    });

    it('endereço incompleto mantém null onde a Receita não informa', () => {
      expect(
        map({
          tipo_logradouro: '',
          logradouro: '',
          numero: 'S/N',
          complemento: '',
          bairro: null,
          cep: '',
        })?.address,
      ).toEqual({
        street: null,
        number: 'S/N',
        complement: null,
        neighborhood: null,
        city: 'SAO PAULO',
        cityIbgeCode: null,
        uf: 'SP',
        zipcode: null,
      });
    });
  });

  describe('CNAEs', () => {
    it('sem a lista de descrições, os códigos ficam com descrição vazia, para o IBGE completar', () => {
      const record = map({ cnaes: undefined });

      expect(record?.mainCnae).toEqual({ code: '6201501', description: '' });
      expect(record?.secondaryCnaes).toEqual([
        { code: '6202300', description: '' },
        { code: '6311900', description: '' },
      ]);
    });

    it('sem cnaes_secundarios, usa os demais itens da lista de CNAEs', () => {
      expect(map({ cnaes_secundarios: undefined })?.secondaryCnaes).toEqual([
        expect.objectContaining({ code: '6202300' }),
        expect.objectContaining({ code: '6311900' }),
      ]);
    });

    it('sem nenhuma das duas listas, não há secundários', () => {
      expect(
        map({ cnaes_secundarios: undefined, cnaes: undefined })?.secondaryCnaes,
      ).toEqual([]);
      expect(
        map({ cnaes_secundarios: [], cnaes: null })?.secondaryCnaes,
      ).toEqual([]);
    });

    it('descarta códigos inválidos, repetidos e o igual ao principal', () => {
      expect(
        map({
          cnaes_secundarios: [
            '6201501',
            '6202300',
            '6202300',
            '0',
            '',
            null,
            'abc',
          ],
        })?.secondaryCnaes,
      ).toEqual([expect.objectContaining({ code: '6202300' })]);
    });

    it('ignora na lista de descrições o item sem código ou sem descrição', () => {
      const record = map({
        cnaes: [
          { codigo: '', descricao: 'sem código' },
          { codigo: '6201501', descricao: '' },
          { codigo: '6202300', descricao: 'Descrita' },
        ],
      });

      expect(record?.mainCnae.description).toBe('');
      expect(record?.secondaryCnaes[0]).toEqual({
        code: '6202300',
        description: 'Descrita',
      });
    });

    it('lista de descrições com item de formato inválido derruba a resposta', () => {
      expect(map({ cnaes: ['6201501'] })).toBeNull();
    });
  });
});

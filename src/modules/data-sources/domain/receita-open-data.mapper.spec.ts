import { receitaOpenDataCnpjFactory } from '@test/factories/data-sources/receita-open-data-cnpj.factory.js';
import { toCadastralRecord } from './receita-open-data.mapper.js';

const CNPJ = '11222333000181';

describe('toCadastralRecord (formato dos dados abertos da Receita)', () => {
  const map = (overrides: Record<string, unknown> = {}) =>
    toCadastralRecord(
      { ...receitaOpenDataCnpjFactory.build(), ...overrides },
      CNPJ,
    );

  describe('resposta completa', () => {
    it('converte para o cadastro do BIOS', () => {
      const body = receitaOpenDataCnpjFactory.build({
        razao_social: 'ACME SERVICOS LTDA',
        nome_fantasia: 'ACME',
      });

      expect(toCadastralRecord(body, CNPJ)).toEqual({
        cnpj: CNPJ,
        legalName: 'ACME SERVICOS LTDA',
        tradeName: 'ACME',
        registrationStatus: 'ATIVA',
        registrationStatusUnrecognized: null,
        companySize: 'DEMAIS',
        address: {
          street: 'AVENIDA PAULISTA',
          number: '1578',
          complement: 'ANDAR 12',
          neighborhood: 'BELA VISTA',
          city: 'SAO PAULO',
          cityIbgeCode: '3550308',
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
  });

  describe('dado de pessoa física (INL02)', () => {
    it('não deixa o quadro societário, nem contatos, chegarem ao cadastro', () => {
      const record = map();
      const text = JSON.stringify(record);

      expect(record).not.toHaveProperty('qsa');
      expect(text).not.toContain('MARIA APARECIDA');
      expect(text).not.toContain('JOAO CARLOS');
      expect(text).not.toContain('***123456**');
      expect(text).not.toContain('1133334444');
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
        'registrationStatusUnrecognized',
        'secondaryCnaes',
        'tradeName',
      ]);
    });
  });

  describe('CNPJ da resposta', () => {
    it('aceita o CNPJ com máscara, em qualquer caixa', () => {
      expect(
        toCadastralRecord(
          receitaOpenDataCnpjFactory.build({ cnpj: '11.222.333/0001-81' }),
          CNPJ,
        ),
      ).not.toBeNull();
      expect(
        toCadastralRecord(
          receitaOpenDataCnpjFactory.build({ cnpj: '12abc34501de35' }),
          '12ABC34501DE35',
        ),
      ).not.toBeNull();
    });

    it('recusa a resposta de outro CNPJ: gravá-la seria pior que não ter dado', () => {
      expect(map({ cnpj: '00000000000191' })).toBeNull();
    });
  });

  describe('campos obrigatórios', () => {
    it.each(['razao_social', 'cnae_fiscal', 'municipio', 'uf'])(
      'recusa a resposta sem %s',
      (field) => {
        expect(map({ [field]: null })).toBeNull();
        expect(map({ [field]: undefined })).toBeNull();
      },
    );

    it('recusa CNAE principal zerado', () => {
      expect(map({ cnae_fiscal: 0 })).toBeNull();
    });

    it('recusa UF que não é uma sigla', () => {
      expect(map({ uf: 'SAO PAULO' })).toBeNull();
    });

    it('recusa a resposta sem situação cadastral (nem descrição nem código)', () => {
      expect(
        map({ descricao_situacao_cadastral: '', situacao_cadastral: null }),
      ).toBeNull();
    });

    it.each([
      ['não é objeto', 'texto'],
      ['é null', null],
      ['é lista', []],
      ['não tem CNPJ', {}],
      ['tem CNPJ que não é texto', { cnpj: 11222333000181 }],
    ])('recusa o corpo que %s', (_case, body) => {
      expect(toCadastralRecord(body, CNPJ)).toBeNull();
    });
  });

  describe('situação cadastral', () => {
    it('usa a descrição', () => {
      expect(map({ descricao_situacao_cadastral: 'Baixada' })).toMatchObject({
        registrationStatus: 'BAIXADA',
      });
    });

    it('traduz o código quando a descrição falta', () => {
      expect(
        map({ descricao_situacao_cadastral: null, situacao_cadastral: 3 }),
      ).toMatchObject({ registrationStatus: 'SUSPENSA' });
    });

    it('situação fora do conjunto não recusa o cadastro: NAO_RECONHECIDA, com o texto do provedor (#338)', () => {
      expect(
        map({
          descricao_situacao_cadastral: 'EM LIQUIDACAO',
          situacao_cadastral: 99,
        }),
      ).toMatchObject({
        registrationStatus: 'NAO_RECONHECIDA',
        registrationStatusUnrecognized: 'EM LIQUIDACAO',
      });
    });
  });

  describe('campos opcionais', () => {
    it('sem nome fantasia, é null', () => {
      expect(map({ nome_fantasia: '' })).toMatchObject({ tradeName: null });
      expect(map({ nome_fantasia: null })).toMatchObject({ tradeName: null });
    });

    it('sem porte, é null; com porte, vai em maiúsculas', () => {
      expect(map({ porte: '' })).toMatchObject({ companySize: null });
      expect(map({ porte: 'Micro Empresa' })).toMatchObject({
        companySize: 'MICRO EMPRESA',
      });
    });

    it('endereço incompleto mantém null onde a Receita não informa', () => {
      const record = map({
        logradouro: '',
        descricao_tipo_de_logradouro: '',
        numero: 'S/N',
        complemento: '',
        bairro: null,
        cep: '',
        codigo_municipio_ibge: 0,
      });

      expect(record?.address).toEqual({
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

    it('CEP e código IBGE vindos como número recuperam os zeros iniciais', () => {
      expect(
        map({ cep: 1310200, codigo_municipio_ibge: 110001 })?.address,
      ).toMatchObject({
        zipcode: '01310200',
        cityIbgeCode: '0110001',
      });
    });

    it('CNAE principal sem descrição fica com descrição vazia, para o IBGE completar', () => {
      expect(map({ cnae_fiscal_descricao: null })?.mainCnae).toEqual({
        code: '6201501',
        description: '',
      });
    });
  });

  describe('CNAEs secundários', () => {
    it('o item de código 0 do provedor significa "sem secundários"', () => {
      expect(
        map({ cnaes_secundarios: [{ codigo: 0, descricao: '' }] })
          ?.secondaryCnaes,
      ).toEqual([]);
    });

    it('lista vazia, ausente ou null resultam em lista vazia', () => {
      expect(map({ cnaes_secundarios: [] })?.secondaryCnaes).toEqual([]);
      expect(map({ cnaes_secundarios: null })?.secondaryCnaes).toEqual([]);
      expect(map({ cnaes_secundarios: undefined })?.secondaryCnaes).toEqual([]);
    });

    it('descarta repetidos e o que repete o CNAE principal', () => {
      expect(
        map({
          cnaes_secundarios: [
            { codigo: 6201501, descricao: 'igual ao principal' },
            { codigo: 6202300, descricao: 'a' },
            { codigo: '6202300', descricao: 'repetido' },
          ],
        })?.secondaryCnaes,
      ).toEqual([{ code: '6202300', description: 'a' }]);
    });

    it('normaliza o código e aceita descrição ausente', () => {
      expect(
        map({ cnaes_secundarios: [{ codigo: 111301 }] })?.secondaryCnaes,
      ).toEqual([{ code: '0111301', description: '' }]);
    });

    it('um item com formato inválido derruba a resposta inteira', () => {
      expect(map({ cnaes_secundarios: ['6202300'] })).toBeNull();
    });
  });
});

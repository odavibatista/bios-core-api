import { faker } from '../../support/faker.js';
import { defineFactory } from '../factory.js';

/** Corpo de `GET /{cnpj}` no formato dos dados abertos da Receita (BrasilAPI e Minha Receita), com os campos que eles devolvem. */
export interface ReceitaOpenDataCnpjBody {
  cnpj: string;
  razao_social: string;
  nome_fantasia: string;
  descricao_situacao_cadastral: string;
  situacao_cadastral: number;
  porte: string;
  codigo_porte: number;
  cnae_fiscal: number;
  cnae_fiscal_descricao: string;
  cnaes_secundarios: { codigo: number; descricao: string }[];
  descricao_tipo_de_logradouro: string;
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  municipio: string;
  uf: string;
  cep: string;
  codigo_municipio_ibge: number;
  codigo_municipio: number;
  natureza_juridica: string;
  capital_social: number;
  data_inicio_atividade: string;
  email: string | null;
  ddd_telefone_1: string;
  opcao_pelo_simples: boolean;
  regime_tributario: {
    ano: number;
    forma_de_tributacao: string;
    quantidade_de_escrituracoes: number;
  }[];
  /** Quadro societário: dado de pessoa física que o BIOS nunca deve guardar (INL02). */
  qsa: {
    nome_socio: string;
    cnpj_cpf_do_socio: string;
    qualificacao_socio: string;
    cpf_representante_legal: string;
    nome_representante_legal: string;
  }[];
}

/** Resposta realista desse formato, com sócios e contatos que o BIOS deve descartar. */
export const receitaOpenDataCnpjFactory =
  defineFactory<ReceitaOpenDataCnpjBody>(() => ({
    cnpj: '11222333000181',
    razao_social: faker.company.name().toUpperCase(),
    nome_fantasia: faker.company.name().toUpperCase(),
    descricao_situacao_cadastral: 'ATIVA',
    situacao_cadastral: 2,
    porte: 'DEMAIS',
    codigo_porte: 5,
    cnae_fiscal: 6201501,
    cnae_fiscal_descricao:
      'Desenvolvimento de programas de computador sob encomenda',
    cnaes_secundarios: [
      {
        codigo: 6202300,
        descricao:
          'Desenvolvimento e licenciamento de programas de computador customizáveis',
      },
      {
        codigo: 6311900,
        descricao: 'Tratamento de dados, provedores de serviços de aplicação',
      },
    ],
    descricao_tipo_de_logradouro: 'AVENIDA',
    logradouro: 'PAULISTA',
    numero: '1578',
    complemento: 'ANDAR 12',
    bairro: 'BELA VISTA',
    municipio: 'SAO PAULO',
    uf: 'SP',
    cep: '01310200',
    codigo_municipio_ibge: 3550308,
    codigo_municipio: 7107,
    natureza_juridica: 'Sociedade Empresária Limitada',
    capital_social: 1_000_000,
    data_inicio_atividade: '2010-03-15',
    email: faker.internet.email(),
    ddd_telefone_1: '1133334444',
    opcao_pelo_simples: false,
    regime_tributario: [
      {
        ano: 2024,
        forma_de_tributacao: 'LUCRO PRESUMIDO',
        quantidade_de_escrituracoes: 1,
      },
    ],
    qsa: [
      {
        nome_socio: 'MARIA APARECIDA DA SILVA SOUZA',
        cnpj_cpf_do_socio: '***123456**',
        qualificacao_socio: 'Sócio-Administrador',
        cpf_representante_legal: '***000000**',
        nome_representante_legal: 'JOAO CARLOS PEREIRA LIMA',
      },
    ],
  }));

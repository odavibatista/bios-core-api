import { faker } from '../../support/faker.js';
import { defineFactory } from '../factory.js';

/** Corpo de `GET /{cnpj}` do OpenCNPJ, com os campos que ele devolve. */
export interface OpenCnpjBody {
  cnpj: string;
  razao_social: string;
  nome_fantasia: string;
  situacao_cadastral: string;
  matriz_filial: string;
  data_inicio_atividade: string;
  cnae_principal: string;
  cnaes_secundarios: string[];
  cnaes: { codigo: string; descricao: string; is_principal: boolean }[];
  natureza_juridica: string;
  tipo_logradouro: string;
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  cep: string;
  uf: string;
  municipio: string;
  codigo_municipio: string;
  email: string;
  telefones: { ddd: string; numero: string; is_fax: boolean }[];
  capital_social: string;
  porte_empresa: string;
  opcao_simples: string;
  lgpd_anonimizado: boolean;
  /** Quadro societário: dado de pessoa física que o BIOS nunca deve guardar (INL02). */
  QSA: {
    nome_socio: string;
    cnpj_cpf_socio: string;
    qualificacao_socio: string;
    nome_representante: string;
  }[];
}

/** Resposta realista do OpenCNPJ, com sócios e contatos que o BIOS deve descartar. */
export const openCnpjFactory = defineFactory<OpenCnpjBody>(() => ({
  cnpj: '11222333000181',
  razao_social: faker.company.name().toUpperCase(),
  nome_fantasia: faker.company.name().toUpperCase(),
  situacao_cadastral: 'Ativa',
  matriz_filial: 'Matriz',
  data_inicio_atividade: '2010-03-15',
  cnae_principal: '6201501',
  cnaes_secundarios: ['6202300', '6311900'],
  cnaes: [
    {
      codigo: '6201501',
      descricao: 'Desenvolvimento de programas de computador sob encomenda',
      is_principal: true,
    },
    {
      codigo: '6202300',
      descricao:
        'Desenvolvimento e licenciamento de programas de computador customizáveis',
      is_principal: false,
    },
    {
      codigo: '6311900',
      descricao: 'Tratamento de dados, provedores de serviços de aplicação',
      is_principal: false,
    },
  ],
  natureza_juridica: 'Sociedade Empresária Limitada',
  tipo_logradouro: 'AVENIDA',
  logradouro: 'PAULISTA',
  numero: '1578',
  complemento: 'ANDAR 12',
  bairro: 'BELA VISTA',
  cep: '01310200',
  uf: 'SP',
  municipio: 'SAO PAULO',
  codigo_municipio: '7107',
  email: faker.internet.email(),
  telefones: [{ ddd: '11', numero: '33334444', is_fax: false }],
  capital_social: '1000000,00',
  porte_empresa: 'Demais',
  opcao_simples: 'N',
  lgpd_anonimizado: false,
  QSA: [
    {
      nome_socio: 'MARIA APARECIDA DA SILVA SOUZA',
      cnpj_cpf_socio: '***123456**',
      qualificacao_socio: 'Sócio-Administrador',
      nome_representante: 'JOAO CARLOS PEREIRA LIMA',
    },
  ],
}));

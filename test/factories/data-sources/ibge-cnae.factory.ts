import { defineFactory } from '../factory.js';

/** Subclasse da CNAE como a API de Classificações do IBGE a devolve. */
export interface IbgeCnaeSubclassBody {
  id: string;
  descricao: string;
  classe: {
    id: string;
    descricao: string;
    grupo: {
      id: string;
      descricao: string;
      divisao: {
        id: string;
        descricao: string;
        secao: { id: string; descricao: string };
      };
    };
    observacoes: string[];
  };
  atividades: string[];
  observacoes: string[];
}

/** Subclasse realista: a estrutura hierárquica inteira que o BIOS descarta. */
export const ibgeCnaeSubclassFactory = defineFactory<IbgeCnaeSubclassBody>(
  () => ({
    id: '6201501',
    descricao: 'DESENVOLVIMENTO DE PROGRAMAS DE COMPUTADOR SOB ENCOMENDA',
    classe: {
      id: '62015',
      descricao: 'DESENVOLVIMENTO DE PROGRAMAS DE COMPUTADOR SOB ENCOMENDA',
      grupo: {
        id: '620',
        descricao: 'ATIVIDADES DOS SERVIÇOS DE TECNOLOGIA DA INFORMAÇÃO',
        divisao: {
          id: '62',
          descricao: 'ATIVIDADES DOS SERVIÇOS DE TECNOLOGIA DA INFORMAÇÃO',
          secao: { id: 'J', descricao: 'INFORMAÇÃO E COMUNICAÇÃO' },
        },
      },
      observacoes: ['Esta classe compreende o desenvolvimento sob encomenda.'],
    },
    atividades: ['DESENVOLVIMENTO DE APLICATIVO INFORMÁTICO SOB ENCOMENDA'],
    observacoes: ['Esta subclasse compreende ...'],
  }),
);

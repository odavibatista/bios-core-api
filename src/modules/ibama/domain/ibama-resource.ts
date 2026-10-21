/**
 * Os dois recursos do IBAMA que o MVP ingere (Projeto e Arquitetura, seção 1):
 * o auto de infração e o termo de embargo. Os auxiliares (enquadramento
 * legal, coordenadas, bioma, espécime, anexos) ficam fora: não há chave
 * confiável para cruzá-los com o recurso principal.
 */
export const IbamaResource = {
  AUTO_INFRACAO: 'AUTO_INFRACAO',
  TERMO_EMBARGO: 'TERMO_EMBARGO',
} as const;

export type IbamaResource = (typeof IbamaResource)[keyof typeof IbamaResource];

/** Como o dump vem empacotado. */
export type IbamaContainer =
  /** Um `.zip` com um CSV por ano (o auto de infração). */
  | 'ZIP_OF_CSV'
  /** Um único `.csv` (o termo de embargo). */
  | 'CSV';

/** Onde o dump está e quais colunas do CSV o adapter lê. */
export interface IbamaResourceDefinition {
  resource: IbamaResource;

  /** Caminho do arquivo depois da `base_url` do catálogo. */
  segments: readonly string[];

  container: IbamaContainer;

  /** Coluna do documento do autuado/embargado (CPF ou CNPJ). */
  documentColumn: string;

  /**
   * Coluna que diz se o documento é de pessoa física (`PF`) ou jurídica (`PJ`).
   * O termo de embargo não a tem: lá o documento é a única pista.
   */
  personTypeColumn: string | null;

  /** Identificador interno do registro no IBAMA; vem vazio nos registros novos. */
  sequenceColumn: string;

  /** Número e série do documento, o identificador público (RF09). */
  numberColumn: string;
  seriesColumn: string;

  /**
   * Colunas guardadas no registro. É uma lista **permitida**: o que não está
   * aqui (nome do autuado, texto livre, geometrias) não sai do adapter.
   */
  payloadColumns: readonly string[];
}

/**
 * Definições dos recursos, conferidas contra os dumps de outubro de 2026.
 *
 * Fora do payload, de propósito:
 *  - **nome do autuado/embargado** (`NOME_INFRATOR`, `NOME_EMBARGADO`) e o
 *    identificador interno da pessoa: a empresa já é identificada pelo CNPJ, e o
 *    nome é o único campo em que um nome de pessoa poderia chegar ao banco
 *    (INL02);
 *  - **texto livre** (descrição do auto, local, justificativas): pode citar
 *    terceiros e CPFs;
 *  - **geometrias** (WKT): podem pesar megabytes por linha e não servem ao índice.
 */
export const IBAMA_RESOURCES: Readonly<
  Record<IbamaResource, IbamaResourceDefinition>
> = {
  [IbamaResource.AUTO_INFRACAO]: {
    resource: IbamaResource.AUTO_INFRACAO,
    segments: [
      'SIFISC',
      'auto_infracao',
      'auto_infracao',
      'auto_infracao_csv.zip',
    ],
    container: 'ZIP_OF_CSV',
    documentColumn: 'CPF_CNPJ_INFRATOR',
    personTypeColumn: 'TP_PESSOA_INFRATOR',
    sequenceColumn: 'SEQ_AUTO_INFRACAO',
    numberColumn: 'NUM_AUTO_INFRACAO',
    seriesColumn: 'SER_AUTO_INFRACAO',
    payloadColumns: [
      'SEQ_AUTO_INFRACAO',
      'NUM_AUTO_INFRACAO',
      'SER_AUTO_INFRACAO',
      'DES_STATUS_FORMULARIO',
      'SIT_CANCELADO',
      'TIPO_AUTO',
      'TIPO_MULTA',
      'VAL_AUTO_INFRACAO',
      'GRAVIDADE_INFRACAO',
      'DAT_HORA_AUTO_INFRACAO',
      'DT_FATO_INFRACIONAL',
      'COD_MUNICIPIO',
      'MUNICIPIO',
      'UF',
      'NUM_PROCESSO',
      'NU_PROCESSO_FORMATADO',
      'COD_INFRACAO',
      'DES_INFRACAO',
      'TIPO_INFRACAO',
      'TP_PESSOA_INFRATOR',
      'QT_AREA',
      'INFRACAO_AREA',
      'DS_BIOMAS_ATINGIDOS',
      'TP_ULT_ALTERACAO',
      'DT_ULT_ALTERACAO',
    ],
  },
  [IbamaResource.TERMO_EMBARGO]: {
    resource: IbamaResource.TERMO_EMBARGO,
    segments: ['TERMOS_DE_EMBARGO', 'TERMO_EMBARGO', 'termo_de_embargo.csv'],
    container: 'CSV',
    documentColumn: 'CPF_CNPJ_EMBARGADO',
    personTypeColumn: null,
    sequenceColumn: 'SEQ_TAD',
    numberColumn: 'NUM_TAD',
    seriesColumn: 'SER_TAD',
    payloadColumns: [
      'SEQ_TAD',
      'NUM_TAD',
      'SER_TAD',
      'DES_STATUS_FORMULARIO',
      'DES_STATUS_FORMULARIO_AIE',
      'SIT_CANCELADO',
      'DAT_EMBARGO',
      'NUM_PROCESSO',
      'COD_MUNICIPIO',
      'MUNICIPIO',
      'UF',
      'DETER_PRODES',
      'QTD_AREA_EMBARGADA',
      'TIPO_AREA',
      'SIT_DESEMBARGO',
      'TIPO_DESEMBARGO',
      'DAT_DESEMBARGO',
      'SEQ_AUTO_INFRACAO',
      'NUM_AUTO_INFRACAO',
      'DAT_ULT_ALTERACAO',
      'TIPO_ALTERACAO',
    ],
  },
};

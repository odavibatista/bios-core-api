import type { IbamaDiscardReason } from '../../ibama-document.js';
import type { IbamaResource } from '../../ibama-resource.js';

/**
 * Registro do IBAMA de uma **pessoa jurídica**, lido do dump e ainda não
 * normalizado em evidência (isso é da normalização, UC14).
 *
 * Quem o recebe pode gravá-lo: o descarte de pessoa física já aconteceu.
 */
export interface IbamaRecord {
  resource: IbamaResource;

  /** CNPJ canônico (14 caracteres, sem pontuação). */
  cnpj: string;

  /**
   * Identificador público do documento no IBAMA: o número e, quando há, a série
   * (`1092-A`; os documentos emitidos desde outubro de 2019 têm número
   * alfanumérico e nenhuma série). É o que o usuário procura no órgão (RF09).
   *
   * **Não é único** no dump: o mesmo número aparece em mais de uma linha (um
   * auto com mais de um registro). Quem normaliza decide como tratar.
   */
  reference: string;

  /** Identificador interno do registro (`SEQ_*`), quando o IBAMA o informa. */
  sequence: string | null;

  /** Colunas permitidas do registro (`IBAMA_RESOURCES`), sem as vazias. */
  payload: Readonly<Record<string, string>>;
}

/** Contagens de uma leitura do dump. */
export interface IbamaReadStats {
  /** Linhas de dados lidas, as descartadas incluídas. */
  rows: number;

  /** Registros entregues (pessoa jurídica com CNPJ válido). */
  kept: number;

  /** Linhas descartadas, por motivo. A soma é o `records_discarded` da execução. */
  discarded: Record<IbamaDiscardReason, number>;
}

/**
 * Um dump já baixado, pronto para ser lido.
 *
 * Baixar e ler são passos separados porque quem ingere precisa do `checksum`
 * antes de ler: dump idêntico ao da última execução bem-sucedida encerra o job
 * sem reprocessar. Terminado o uso, `dispose` apaga os arquivos temporários;
 * quem recebe um `IbamaDump` é responsável por chamá-lo, mesmo em falha.
 */
export interface IbamaDump {
  resource: IbamaResource;

  /** SHA-256 do arquivo baixado, em hexadecimal. */
  checksum: string;

  /** Tamanho do arquivo baixado, em bytes. */
  bytes: number;

  /**
   * Contagens da leitura mais recente de `records()`; reiniciadas a cada
   * leitura e só completas quando ela termina.
   */
  stats: IbamaReadStats;

  /**
   * Lê o dump em fluxo e entrega só os registros de pessoa jurídica. Uma linha
   * de pessoa física nunca sai daqui.
   *
   * @throws {IbamaDumpFormatError} quando o arquivo não tem o formato esperado
   * (coluna que sumiu, `.zip` sem CSV): o IBAMA mudou o dump, e seguir seria
   * ingerir lixo ou nada.
   */
  records(): AsyncGenerator<IbamaRecord>;

  /** Apaga os arquivos temporários do dump. Pode ser chamado mais de uma vez. */
  dispose(): Promise<void>;
}

/**
 * O dump baixado não tem o formato que o adapter conhece. Não é uma falha da
 * fonte indisponível (ela respondeu): é uma mudança no dump, que exige
 * ajustar o adapter, e por isso deve aparecer como erro do job.
 */
export class IbamaDumpFormatError extends Error {
  constructor(reason: string) {
    super(`Dump do IBAMA fora do formato esperado: ${reason}`);
    this.name = 'IbamaDumpFormatError';
  }
}

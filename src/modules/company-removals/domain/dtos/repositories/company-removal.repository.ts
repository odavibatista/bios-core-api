/** Cadastro retirado, como o repositório o devolve. */
export interface CompanyRemovalRecord {
  cnpj: string;
  removedAt: Date;
}

/**
 * Cadastros retirados a pedido do titular: quem coleta consulta a lista, e a retirada apaga o que
 * já estava guardado.
 *
 * Classe abstrata (e não interface) para servir também como token de injeção.
 */
export abstract class CompanyRemovalRepository {
  /** Indica se o CNPJ foi retirado. */
  abstract isRemoved(cnpj: string): Promise<boolean>;

  /** Todos os CNPJs retirados, para a carga em lote não consultar registro a registro. */
  abstract findAllCnpjs(): Promise<ReadonlySet<string>>;

  /** Registra a retirada e apaga cadastro, evidências, índices e movimentações do CNPJ. */
  abstract remove(cnpj: string): Promise<CompanyRemovalRecord>;

  /** Tira o CNPJ da lista. Indica se ele estava nela. */
  abstract restore(cnpj: string): Promise<boolean>;

  /** Página da lista, da retirada mais recente para a mais antiga. */
  abstract list(window: {
    skip: number;
    take: number;
  }): Promise<{ rows: CompanyRemovalRecord[]; total: number }>;
}

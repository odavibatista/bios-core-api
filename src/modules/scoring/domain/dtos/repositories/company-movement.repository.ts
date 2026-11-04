import type {
  DatedContribution,
  DetectedOdsMovement,
  ReconstructedOdsMovement,
} from '../../ods-movement-rules.js';

/** Um índice calculado, com as contribuições datadas pela evidência de cada uma. */
export interface MovementCandidateScore {
  odsId: string;
  odsNumber: number;
  contributions: DatedContribution[];
}

/** Empresa com perfil e índice que ainda não tem movimentação. */
export interface MovementCandidate {
  cnpj: string;
  scores: MovementCandidateScore[];
}

/** Uma página da varredura. */
export interface MovementCandidatesPage {
  candidates: MovementCandidate[];

  /** Último CNPJ lido, para a próxima página; nulo quando a base acabou. */
  nextCursor: string | null;
}

/** A movimentação reconstruída de um ODS. */
export interface ReconstructedMovementToSave extends ReconstructedOdsMovement {
  odsId: string;
  odsNumber: number;
}

/** Janela de leitura da lista. */
export interface CompanyMovementsWindow {
  skip: number;
  take: number;
}

/** A movimentação de uma empresa, como a lista a lê. */
export interface CompanyMovementRow {
  cnpj: string;
  movedAt: Date;
  movements: (DetectedOdsMovement & { odsNumber: number; movedAt: Date })[];
}

export interface CompanyMovementsPage {
  rows: CompanyMovementRow[];

  /** Total de empresas com movimentação. */
  total: number;
}

/** Contrato de `company_movements` fora do recálculo, que grava na própria transação. */
export abstract class CompanyMovementRepository {
  /** A janela pedida, da mais recente para a mais antiga, com o CNPJ como desempate. */
  abstract findPage(
    window: CompanyMovementsWindow,
  ): Promise<CompanyMovementsPage>;

  /**
   * Empresas com perfil, a partir do cursor (exclusivo), em ordem de CNPJ, das quais ficam as
   * que não têm movimentação. Lê `limit` perfis por chamada: a página pode vir vazia com a
   * varredura ainda em andamento.
   */
  abstract findCandidates(
    afterCnpj: string | null,
    limit: number,
  ): Promise<MovementCandidatesPage>;

  /**
   * Cria a movimentação reconstruída, sem nunca alterar a que já existe: um recálculo que
   * gravou durante a varredura tem a informação melhor. Devolve se criou.
   */
  abstract createIfMissing(
    cnpj: string,
    movements: readonly ReconstructedMovementToSave[],
  ): Promise<boolean>;
}

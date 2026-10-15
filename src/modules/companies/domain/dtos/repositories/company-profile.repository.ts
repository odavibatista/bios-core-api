import type { CompanyProfileResponse } from '../requests/company-profile.dto.js';

/** Perfil cadastral guardado, com o que a política de cache precisa saber dele. */
export interface StoredCompanyProfile {
  /** O perfil no formato em que a API o expõe. */
  profile: CompanyProfileResponse;

  /** Fonte que respondeu o cadastro (`data_sources.slug`), que define a janela de validade. */
  cadastralSourceSlug: string;

  /** Quando o cadastro foi atualizado pela última vez. */
  refreshedAt: Date;
}

/**
 * Contrato do perfil cadastral guardado (RF05).
 *
 * Só leitura: quem grava `company_profile` é o serviço de ingestão do CNPJ,
 * dono do fluxo; o core publica o pedido na fila e lê o resultado.
 *
 * Classe abstrata (e não interface) para servir também como token de injeção.
 */
export abstract class CompanyProfileRepository {
  /** Localiza o perfil pelo CNPJ canônico. */
  abstract findByCnpj(cnpj: string): Promise<StoredCompanyProfile | null>;
}

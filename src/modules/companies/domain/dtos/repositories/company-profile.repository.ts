import type { CadastralRecord } from '@modules/data-sources/domain/dtos/providers/cadastral-record.dto.js';
import type { CompanyProfileResponse } from '../requests/company-profile.dto.js';

/** Perfil cadastral guardado, com o que a política de cache precisa saber dele. */
export interface StoredCompanyProfile {
  /** O perfil no formato em que a API o expõe. */
  profile: CompanyProfileResponse;

  /** Fonte que respondeu o cadastro (`data_sources.slug`), que define a janela de validade. */
  cadastralSourceSlug: string;

  /** Quando o cadastro foi atualizado pela última vez. */
  refreshedAt: Date;

  /** Hash do conteúdo cadastral atual. */
  contentHash: string;

  /** Hash da versão cadastral anterior, quando já houve mudança. */
  previousContentHash: string | null;
}

/** Cadastro a gravar, já saneado e com os hashes calculados. */
export interface SaveCompanyProfileInput {
  record: CadastralRecord;

  /** Provedor que respondeu (`data_sources.slug`). */
  sourceSlug: string;

  contentHash: string;
  previousContentHash: string | null;
  refreshedAt: Date;
}

/**
 * Contrato do perfil cadastral guardado (RF05).
 *
 * Quem grava é o `RefreshCompanyProfileUseCase`, disparado pelo consumidor da
 * fila `company-profile`; o restante do sistema só lê.
 *
 * Classe abstrata (e não interface) para servir também como token de injeção.
 */
export abstract class CompanyProfileRepository {
  /** Localiza o perfil pelo CNPJ canônico. */
  abstract findByCnpj(cnpj: string): Promise<StoredCompanyProfile | null>;

  /**
   * Grava o cadastro, criando o perfil ou atualizando o existente (chave: CNPJ).
   *
   * @throws quando a fonte não existe no catálogo.
   */
  abstract save(input: SaveCompanyProfileInput): Promise<void>;
}

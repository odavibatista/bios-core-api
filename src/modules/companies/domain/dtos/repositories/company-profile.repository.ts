import type { CadastralRecord } from '@modules/data-sources/domain/dtos/providers/cadastral-record.dto.js';
import type { CompanyProfileResponse } from '../requests/company-profile.dto.js';
import type { CompanySearchItem } from '../requests/search-companies.dto.js';

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

/** Índice e confiança do ODS selecionado, com os mínimos opcionais. */
export interface SearchOdsCriteria {
  /** Número do ODS (índice e confiança dele vêm junto de cada empresa). */
  number: number;

  /** Índice mínimo (inclusive); empresa sem índice calculado não passa. */
  minScore?: number;

  /** Confiança mínima (inclusive); empresa sem confiança calculada não passa. */
  minConfidence?: number;

  /** Ordena pelo índice do ODS; sem ele, vale a ordem padrão da pesquisa. */
  order?: 'asc' | 'desc';
}

/** Pesquisa já traduzida: critérios normalizados e janela. */
export interface SearchCompaniesInput {
  /** Palavras normalizadas do nome (`company-name-terms`); vazio: sem filtro por nome. */
  nameTerms: string[];

  /** Sigla da UF do endereço. */
  uf?: string;

  /** Palavras normalizadas do nome do município. */
  cityTerms?: string[];

  /** Código CNAE (2 a 7 dígitos), tratado como prefixo, do CNAE principal ou de um secundário. */
  cnaePrefix?: string;

  /** ODS selecionado e seus mínimos. */
  ods?: SearchOdsCriteria;

  /** Posição inicial da janela (itens a pular). */
  skip: number;

  /** Tamanho da janela. */
  take: number;
}

/** Janela de resultados da pesquisa e o total que atende aos critérios. */
export interface SearchCompaniesResult {
  items: CompanySearchItem[];
  total: number;
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
   * Pesquisa entre os perfis guardados (UC06, fluxo 1.1; UC08): as empresas que atendem a
   * todos os critérios informados (nome, UF, município, CNAE e, para um ODS selecionado,
   * índice e confiança mínimos).
   *
   * Com nome, os mais próximos da frase digitada vêm primeiro; o desempate é a razão
   * social e o CNPJ, para que a paginação seja estável.
   */
  abstract search(input: SearchCompaniesInput): Promise<SearchCompaniesResult>;

  /**
   * Grava o cadastro, criando o perfil ou atualizando o existente (chave: CNPJ).
   *
   * @throws quando a fonte não existe no catálogo.
   */
  abstract save(input: SaveCompanyProfileInput): Promise<void>;
}

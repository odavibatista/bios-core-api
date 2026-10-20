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

/** Busca por nome já traduzida: palavras normalizadas (`company-name-terms`) e janela. */
export interface SearchByNameInput {
  /** Palavras normalizadas; a empresa precisa casar com todas. */
  terms: string[];

  /** Posição inicial da janela (itens a pular). */
  skip: number;

  /** Tamanho da janela. */
  take: number;
}

/** Janela de resultados da busca por nome e o total que atende à consulta. */
export interface SearchByNameResult {
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
   * Procura entre os perfis guardados as empresas cuja razão social ou nome
   * fantasia tem uma palavra começando por cada um dos termos (UC06, fluxo 1.1).
   *
   * Os mais próximos da frase digitada vêm primeiro; o desempate é a razão
   * social e o CNPJ, para que a paginação seja estável.
   */
  abstract searchByName(input: SearchByNameInput): Promise<SearchByNameResult>;

  /**
   * Grava o cadastro, criando o perfil ou atualizando o existente (chave: CNPJ).
   *
   * @throws quando a fonte não existe no catálogo.
   */
  abstract save(input: SaveCompanyProfileInput): Promise<void>;
}

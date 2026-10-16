import type { CadastralRecord } from '@modules/data-sources/domain/dtos/providers/cadastral-record.dto.js';

/**
 * Cadastro obtido pela cadeia, com o provedor que o respondeu.
 *
 * O provedor importa: `company_profile.cadastral_source_id` aponta para a
 * fonte da última atualização, e a janela de validade do cache vem do
 * catálogo dessa fonte (NFDE01).
 */
export interface CadastralLookup {
  record: CadastralRecord;

  /** Slug do provedor que respondeu (`data_sources.slug`), ex.: `OPEN_CNPJ`. */
  sourceSlug: string;
}

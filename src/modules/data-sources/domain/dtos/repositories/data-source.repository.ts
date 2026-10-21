import type { DataSourceRequestConfig } from '../providers/data-source-request.dto.js';
import type { EvidenceSourceConfig } from '../providers/evidence-source.dto.js';

/**
 * Contrato de acesso ao catálogo de fontes externas.
 *
 * Classe abstrata (e não interface) para servir também como token de injeção.
 */
export abstract class DataSourceRepository {
  /**
   * Janela de validade do cache das consultas a uma fonte, em segundos.
   *
   * Devolve `null` quando a fonte não existe ou não tem janela configurada —
   * quem chama decide a reserva, porque a ausência não é erro.
   */
  abstract findCacheTtlSeconds(slug: string): Promise<number | null>;

  /**
   * Configuração que as chamadas à fonte respeitam: endereço, habilitação,
   * limite por minuto e tempo máximo. `null` quando a fonte não existe.
   */
  abstract findRequestConfig(
    slug: string,
  ): Promise<DataSourceRequestConfig | null>;

  /**
   * Slugs das fontes cadastrais habilitadas, na ordem da cadeia de fallback
   * (`fallback_priority` crescente). Fontes desabilitadas ou sem prioridade
   * definida ficam de fora.
   */
  abstract findCadastralChain(): Promise<string[]>;

  /**
   * Categoria e ODS das evidências de uma fonte. `null` quando a fonte não
   * existe ou não é de evidências (`role` diferente de `EVIDENCE`, ou sem
   * categoria/ODS no catálogo).
   */
  abstract findEvidenceSource(
    slug: string,
  ): Promise<EvidenceSourceConfig | null>;
}

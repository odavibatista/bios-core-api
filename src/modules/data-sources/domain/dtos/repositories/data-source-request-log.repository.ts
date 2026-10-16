import type { DataSourceRequestLogEntry } from '../providers/data-source-request.dto.js';

/**
 * Contrato do log de requisições às fontes externas.
 *
 * Base da auditoria do limite de requisições (NFPD01), do diagnóstico da cadeia
 * de fallback e do indicador de cobertura por fonte. Cada linha expira pela
 * política de retenção (`data-retention.config.ts`).
 *
 * Classe abstrata (e não interface) para servir também como token de injeção.
 */
export abstract class DataSourceRequestLogRepository {
  abstract record(entry: DataSourceRequestLogEntry): Promise<void>;
}

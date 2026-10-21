import { UnknownDataSourceError } from '../../../domain/dtos/errors/unknown-data-source.error.js';
import type { DataSourceRepository } from '../../../domain/dtos/repositories/data-source.repository.js';

/**
 * Identificador, no catálogo, da fonte a que a execução pertence.
 *
 * @throws {UnknownDataSourceError} quando o slug não existe: é erro de
 * configuração (o seed não rodou), e não uma situação a tratar.
 */
export async function resolveSourceId(
  dataSourceRepository: DataSourceRepository,
  slug: string,
): Promise<string> {
  const source = await dataSourceRepository.findRequestConfig(slug);

  if (!source) throw new UnknownDataSourceError(slug);

  return source.id;
}

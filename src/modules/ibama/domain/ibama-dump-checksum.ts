import { contentHash } from '@shared/domain/canonical-json.js';
import type { IbamaDump } from './dtos/providers/ibama-dump.dto.js';

/**
 * Checksum do lote: um só para os dois dumps do IBAMA (UC14).
 *
 * `ingestion_runs` guarda **um** `dump_checksum` por execução, e o lote tem dois
 * arquivos (autos de infração e termos de embargo). O checksum combinado é o
 * hash do mapa recurso → SHA-256 do arquivo, com as chaves ordenadas: muda se
 * **qualquer** dos dois muda, não depende da ordem em que foram baixados e,
 * por incluir o recurso, não confunde um arquivo trocado pelo outro.
 */
export function combineDumpChecksums(
  dumps: readonly Pick<IbamaDump, 'resource' | 'checksum'>[],
): string {
  return contentHash(
    Object.fromEntries(
      dumps.map(({ resource, checksum }) => [resource, checksum]),
    ),
  );
}

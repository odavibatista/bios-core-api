import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Injectable } from '@nestjs/common';
import {
  type SourceLookupResult,
  toLookupResult,
} from '@modules/data-sources/domain/data-source.interface.js';
import {
  type SourceCallContext,
  SourceOutcome,
} from '@modules/data-sources/domain/dtos/providers/data-source-request.dto.js';
import type { SourceDownloadedFile } from '@modules/data-sources/domain/providers/source-http-client.provider.js';
import { RequestDataSourceUseCase } from '@modules/data-sources/infra/usecases/request/request-data-source.usecase.js';
import { z } from 'zod';
import type { IbamaDump } from '../../domain/dtos/providers/ibama-dump.dto.js';
import {
  IBAMA_RESOURCES,
  type IbamaResource,
} from '../../domain/ibama-resource.js';
import { FileIbamaDump } from './file-ibama-dump.js';

/** Identificador do IBAMA no catálogo de fontes (`data_sources.slug`). */
export const IBAMA_SLUG = 'IBAMA';

/** Maior dump aceito no download (hoje: 123 MB o auto de infração, 210 MB o embargo). */
export const MAX_DUMP_BYTES = 1024 * 1024 * 1024;

/** O que o download devolve no corpo do sucesso. */
const DownloadedFileSchema = z.object({
  path: z.string(),
  bytes: z.number().int().positive(),
  checksum: z.string().regex(/^[0-9a-f]{64}$/),
});

/**
 * Adapter do IBAMA — dumps em lote de autos de infração e termos de embargo
 * (UC14, NFPD02).
 *
 * O IBAMA **não tem consulta por CNPJ**: publica o dump inteiro em URL fixa por
 * recurso. Por isso este adapter não implementa `DataSourceInterface` (que
 * consulta um item): ele **baixa** o dump e entrega um `IbamaDump` para ser lido
 * em fluxo, só com os registros de pessoa jurídica (INL02).
 *
 *  - O arquivo vem de `{base_url}/{caminho do recurso}` (`IBAMA_RESOURCES`);
 *    limite por minuto, tempo máximo e log de requisições são os do catálogo,
 *    como nas demais fontes (`RequestDataSourceUseCase`).
 *  - O download vai para uma pasta temporária, em fluxo e com limite de
 *    tamanho; o SHA-256 sai pronto, para detectar dump repetido.
 *  - **404 não é "sem registro"**: para um arquivo, é o dump que não está onde o
 *    catálogo diz (URL errada ou o IBAMA o moveu). Vira `UNAVAILABLE`, e não
 *    `NOT_FOUND`, para nunca ser confundido com "nenhuma empresa encontrada".
 *  - Quem recebe o `IbamaDump` precisa chamar `dispose()` ao terminar.
 */
@Injectable()
export class IbamaDataSource {
  readonly slug = IBAMA_SLUG;

  constructor(private readonly requestDataSource: RequestDataSourceUseCase) {}

  async download(
    resource: IbamaResource,
    context: SourceCallContext,
  ): Promise<SourceLookupResult<IbamaDump>> {
    const definition = IBAMA_RESOURCES[resource];
    const directory = await mkdtemp(join(tmpdir(), 'bios-ibama-'));
    const destination = join(directory, 'dump');

    try {
      const response = await this.requestDataSource.execute({
        slug: this.slug,
        segments: definition.segments,
        download: { destination, maxBytes: MAX_DUMP_BYTES },
        context,
      });

      const file = toLookupResult(response, (body) => {
        const parsed = DownloadedFileSchema.safeParse(body);

        return parsed.success && parsed.data.path === destination
          ? (parsed.data satisfies SourceDownloadedFile)
          : null;
      });

      if (file.status === 'FOUND') {
        return {
          status: 'FOUND',
          data: new FileIbamaDump(definition, file.data, directory),
        };
      }

      await rm(directory, { recursive: true, force: true });

      return file.status === 'NOT_FOUND'
        ? {
            status: 'UNAVAILABLE',
            reason: SourceOutcome.FAILURE,
            message: `dump "${definition.segments.join('/')}" não encontrado (HTTP 404): confira a base_url da fonte no catálogo`,
          }
        : file;
    } catch (error) {
      await rm(directory, { recursive: true, force: true });

      throw error;
    }
  }
}

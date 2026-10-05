import {
  DataSourceRole,
  EvidenceCategory,
  IngestionMode,
  type Prisma,
  type PrismaClient,
} from '@prisma/client';
import { DatabaseSeeder } from '@shared/infra/database/database-seeder.js';

type DataSourceDefinition = Omit<Prisma.DataSourceCreateInput, 'ods'> & {
  /** Número do ODS vinculado às evidências da fonte. */
  ods_number?: number;
};

const ONE_DAY = 86_400;

/**
 * Fontes externas do MVP (ver Projeto e Arquitetura, seção 1).
 *
 * A cadeia de fallback cadastral segue `fallback_priority`. Limites, timeouts e
 * janelas de cache são valores iniciais, ajustáveis no banco sem novo deploy.
 */
export const DATA_SOURCES: readonly DataSourceDefinition[] = [
  {
    slug: 'BRASIL_API',
    name: 'BrasilAPI — CNPJ',
    base_url: 'https://brasilapi.com.br/api/cnpj/v1',
    role: DataSourceRole.CADASTRAL,
    ingestion_mode: IngestionMode.ON_DEMAND,
    fallback_priority: 1,
    cache_ttl_seconds: 7 * ONE_DAY,
    request_timeout_ms: 5_000,
  },
  {
    slug: 'OPEN_CNPJ',
    name: 'OpenCNPJ',
    base_url: 'https://api.opencnpj.org',
    role: DataSourceRole.CADASTRAL,
    ingestion_mode: IngestionMode.ON_DEMAND,
    fallback_priority: 2,
    cache_ttl_seconds: 7 * ONE_DAY,
    request_timeout_ms: 5_000,
  },
  {
    slug: 'MINHA_RECEITA',
    name: 'Minha Receita',
    base_url: 'https://minhareceita.org',
    role: DataSourceRole.CADASTRAL,
    ingestion_mode: IngestionMode.ON_DEMAND,
    fallback_priority: 3,
    cache_ttl_seconds: 7 * ONE_DAY,
    request_timeout_ms: 5_000,
  },
  {
    slug: 'IBGE_CNAE',
    name: 'IBGE — API de Classificações (CNAE)',
    base_url: 'https://servicodados.ibge.gov.br/api/v2/cnae',
    role: DataSourceRole.CNAE_TAXONOMY,
    ingestion_mode: IngestionMode.ON_DEMAND,
    cache_ttl_seconds: 30 * ONE_DAY,
    request_timeout_ms: 5_000,
  },
  {
    slug: 'IBAMA',
    name: 'IBAMA — Dados Abertos',
    base_url: 'https://dadosabertos.ibama.gov.br',
    role: DataSourceRole.EVIDENCE,
    ingestion_mode: IngestionMode.DAILY_BATCH,
    evidence_category: EvidenceCategory.INFRACAO_AMBIENTAL,
    ods_number: 15,
    request_timeout_ms: 60_000,
  },
  {
    slug: 'CGU_CEIS',
    name: 'CGU — Cadastro de Empresas Inidôneas e Suspensas (CEIS)',
    base_url: 'https://api.portaldatransparencia.gov.br/api-de-dados/ceis',
    role: DataSourceRole.EVIDENCE,
    ingestion_mode: IngestionMode.ON_DEMAND,
    evidence_category: EvidenceCategory.CONDUTA_ADMINISTRATIVA,
    ods_number: 15,
    rate_limit_per_minute: 90,
    cache_ttl_seconds: ONE_DAY,
    request_timeout_ms: 5_000,
  },
  {
    slug: 'CGU_CNEP',
    name: 'CGU — Cadastro Nacional de Empresas Punidas (CNEP)',
    base_url: 'https://api.portaldatransparencia.gov.br/api-de-dados/cnep',
    role: DataSourceRole.EVIDENCE,
    ingestion_mode: IngestionMode.ON_DEMAND,
    evidence_category: EvidenceCategory.CONDUTA_ADMINISTRATIVA,
    ods_number: 15,
    rate_limit_per_minute: 90,
    cache_ttl_seconds: ONE_DAY,
    request_timeout_ms: 5_000,
  },
  {
    slug: 'GHG_PROTOCOL',
    name: 'GHG Protocol — Registro Público de Emissões',
    base_url: 'https://registropublicodeemissoes.fgv.br',
    role: DataSourceRole.EVIDENCE,
    ingestion_mode: IngestionMode.BEST_EFFORT,
    evidence_category: EvidenceCategory.EMISSAO_GEE,
    ods_number: 13,
    cache_ttl_seconds: 30 * ONE_DAY,
    request_timeout_ms: 10_000,
  },
];

/**
 * Popula a coleção `data_sources`. Depende do `OdsSeeder`.
 *
 * Fontes já existentes não são alteradas: limites, prioridades e habilitação
 * ajustados em produção prevalecem sobre os valores iniciais.
 */
export class DataSourcesSeeder extends DatabaseSeeder {
  override readonly name = 'data-sources';

  override async run(client: PrismaClient): Promise<void> {
    const odsIdByNumber = await this.loadOdsIds(client);

    for (const { ods_number, ...source } of DATA_SOURCES) {
      const ods =
        ods_number === undefined
          ? undefined
          : { connect: { id_ods: odsIdByNumber.get(ods_number) } };

      await client.dataSource.upsert({
        where: { slug: source.slug },
        create: { ...source, ods },
        update: {},
      });
    }
  }

  private async loadOdsIds(client: PrismaClient): Promise<Map<number, string>> {
    const required = [
      ...new Set(DATA_SOURCES.flatMap(({ ods_number }) => ods_number ?? [])),
    ];
    const records = await client.ods.findMany({
      where: { ods_number: { in: required } },
      select: { id_ods: true, ods_number: true },
    });
    const idByNumber = new Map(
      records.map(({ ods_number, id_ods }) => [ods_number, id_ods]),
    );
    const missing = required.filter((number) => !idByNumber.has(number));

    if (missing.length > 0) {
      throw new Error(
        `Seeder "${this.name}": ODS ${missing.join(', ')} ausente(s). ` +
          'Execute o seeder de ODS antes deste.',
      );
    }

    return idByNumber;
  }
}

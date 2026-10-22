import { z } from 'zod';
import { parseCnpj } from '@shared/domain/value-objects/cnpj.js';
import type { EvidenceBatchEntry } from '@modules/evidences/domain/dtos/providers/evidence-batch.dto.js';

export const GHG_SLUG = 'GHG_PROTOCOL';
export const GHG_PUBLIC_API = [
  'api',
  'services',
  'app',
  'EstatisticaPublica',
] as const;
const Id = z.number().int().positive();
const Year = z.number().int().min(2008).max(2100);
export const GhgInventorySchema = z.object({
  cnpj: z.string().refine((s) => parseCnpj(s) === s),
  organizationId: Id,
  cycleId: Id,
  year: Year,
});
export type GhgInventory = z.infer<typeof GhgInventorySchema>;
const Envelope = z.object({
  success: z.literal(true),
  error: z.null(),
  unAuthorizedRequest: z.literal(false),
  result: z.unknown(),
});
/**
 * Busca paginada de organizações do portal (`SearchAllOrganizations`, `POST`).
 *
 * É a única rota que lista o cadastro inteiro: `GetAllOrganizations` devolve só
 * uma amostra de 10 organizações (o portal tinha 1029 em outubro de 2026), e
 * tomá-la pelo cadastro deixaria a coleta cega para quase todas as empresas. O
 * limite de `maxResultCount` é 1000 (o portal recusa mais com HTTP 400).
 */
export const GHG_ORGANIZATION_SEARCH = [
  ...GHG_PUBLIC_API,
  'SearchAllOrganizations',
] as const;
/** Maior página que o portal aceita; a resposta lida nunca passa disso. */
export const GHG_PORTAL_MAX_PAGE_SIZE = 1000;
/**
 * Tamanho pedido em cada página da sincronização. Metade do máximo: a chamada
 * leva ~3 s de latência fixa mais ~5 ms por item (1000 itens: ~7 s), então 500
 * mantém cada chamada bem abaixo do tempo máximo do catálogo (10 s).
 */
export const GHG_ORGANIZATIONS_PAGE_SIZE = 500;
/** Teto do cadastro aceito: bem acima do real, só para uma resposta anormal não rodar sem fim. */
export const GHG_MAX_ORGANIZATIONS = 20000;
/**
 * Tempo total da sincronização do cadastro. É um trabalho de fundo, fora do
 * caminho de qualquer consulta: seu limite não é o do catálogo (que vale para
 * cada chamada), e sim o de uma listagem inteira, com folga para o portal lento.
 */
export const GHG_SYNC_BUDGET_MS = 120_000;
/**
 * Por quanto o cadastro sincronizado vale. A sincronização é diária: sete dias
 * deixam passar falhas seguidas dela sem cegar a coleta, e o cadastro de
 * organizações muda pouco.
 */
export const GHG_ORGANIZATIONS_TTL_SECONDS = 7 * 86_400;
/** Identificador do cadastro no cache: é um só, e não de uma empresa. */
export const GHG_ORGANIZATIONS_CACHE_ID = 'all';
const Organization = z.object({ id: Id, name: z.string().min(1) });
export type GhgOrganization = z.infer<typeof Organization>;
/** O cadastro de organizações como foi sincronizado, com a data da sincronização. */
export const GhgOrganizationsSnapshotSchema = z.object({
  syncedAt: z.iso.datetime(),
  organizations: z.array(Organization).min(1).max(GHG_MAX_ORGANIZATIONS),
});
export type GhgOrganizationsSnapshot = z.infer<
  typeof GhgOrganizationsSnapshotSchema
>;
export interface GhgOrganizationsPage {
  /** Tamanho do cadastro informado pelo portal, que pode passar do que veio nesta página. */
  total: number;
  organizations: GhgOrganization[];
}
export function readOrganizationsPage(body: unknown): GhgOrganizationsPage {
  return z
    .object({
      total: z.number().int().nonnegative().max(GHG_MAX_ORGANIZATIONS),
      organizations: z.array(Organization).max(GHG_PORTAL_MAX_PAGE_SIZE),
    })
    .parse(Envelope.parse(body).result);
}
export function readInventories(body: unknown) {
  return z
    .object({
      inventories: z.array(z.object({ year: Year, cycleId: Id })).max(100),
      errorMsg: z.null(),
      warnMsg: z.null(),
    })
    .parse(Envelope.parse(body).result).inventories;
}
/** Nome e apenas pista de busca. A identidade vem exclusivamente do CNPJ do PDF. */
export function candidateOrganizations(
  organizations: readonly GhgOrganization[],
  names: readonly string[],
) {
  const normalized = names.map(normalizeName).filter((s) => s.length >= 5);
  return organizations
    .filter((org) => {
      const name = normalizeName(org.name);
      return (
        name.length >= 5 &&
        normalized.some((hint) => hint.includes(name) || name.includes(hint))
      );
    })
    .slice(0, 3);
}
function normalizeName(s: string) {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}
/** Hosts observados no appconfig e no download do portal; catalogos antigos continuam validos. */
export function ghgBaseUrl(base: string, report = false) {
  const url = new URL(base);
  const known = [
    'registropublicodeemissoes.fgv.br',
    'registropublicodeemissoesapi.fgv.br',
  ];
  if (known.includes(url.hostname))
    url.hostname = report
      ? 'sistema-registropublicodeemissoesapi.fgv.br'
      : 'registropublicodeemissoesapi.fgv.br';
  return url.toString();
}
/** Extrai somente rotulos de identidade das primeiras paginas, sem reter texto pessoal. */
export function readReportIdentity(
  text: string,
): { cnpj: string; year: number } | null {
  const clean = text.replace(/[\u200b-\u200f\u2060\ufeff]/g, '');
  const documents = [
    ...clean.matchAll(
      /CNPJ\s*:\s*([A-Z0-9]{2}\.?[A-Z0-9]{3}\.?[A-Z0-9]{3}\/?[A-Z0-9]{4}-?\d{2})(?![A-Z0-9])/gi,
    ),
  ].map((m) => parseCnpj(m[1]));
  const years = [...clean.matchAll(/Ano\s+inventariado\s*:\s*(\d{4})/gi)].map(
    (m) => Number(m[1]),
  );
  const cnpjs = new Set(documents);
  const uniqueYears = new Set(years);
  if (
    cnpjs.size !== 1 ||
    documents[0] == null ||
    uniqueYears.size !== 1 ||
    !Year.safeParse(years[0]).success
  )
    return null;
  return { cnpj: documents[0], year: years[0] };
}
export function toGhgEvidence(inventory: GhgInventory): EvidenceBatchEntry {
  const { cnpj, organizationId, cycleId, year } = inventory;
  return {
    cnpj,
    raw: { cnpj, organizationId, cycleId, year },
    finding: {
      reference: `${organizationId}/${cycleId}`,
      url: `https://sistema-registropublicodeemissoesapi.fgv.br/GenerateReport/GenerateInventoryReport/${organizationId}/${cycleId}/true`,
      summary: `Inventario de emissoes de GEE publicado: ano ${year}.`,
      details: { organizationId, cycleId, inventoryYear: year },
      // Ano inventariado nao e data de publicacao; a fonte nao informa esta data.
    },
  };
}

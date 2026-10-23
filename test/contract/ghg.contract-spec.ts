import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  GHG_ORGANIZATION_SEARCH,
  GHG_ORGANIZATIONS_PAGE_SIZE,
  GHG_PUBLIC_API,
  ghgBaseUrl,
  readInventories,
  readOrganizationsPage,
  type GhgOrganization,
} from '@modules/ghg/domain/ghg-inventory.js';
import { GhgReportReader } from '@modules/ghg/infra/providers/ghg-report-reader.provider.js';
import { callSource, joinUrl, seededBaseUrl } from './support.js';

/** Limite de download do relatório no adapter (ghg.data-source.ts). */
const MAX_REPORT_BYTES = 5 * 1024 * 1024;
/** Quantas organizações se tenta até achar uma com inventário publicado. */
const INVENTORY_PROBES = 40;

const apiBase = () => ghgBaseUrl(seededBaseUrl('GHG_PROTOCOL'));
const reportBase = () => ghgBaseUrl(seededBaseUrl('GHG_PROTOCOL'), true);

const searchPage = async (skipCount: number) => {
  const response = await callSource(
    joinUrl(apiBase(), GHG_ORGANIZATION_SEARCH),
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        maxResultCount: GHG_ORGANIZATIONS_PAGE_SIZE,
        skipCount,
      }),
    },
  );

  return { response, body: (await response.json()) as unknown };
};

describe('contrato do GHG Protocol', () => {
  let first: { organizations: GhgOrganization[]; total: number };
  let firstContentType: string;

  beforeAll(async () => {
    const { response, body } = await searchPage(0);

    expect(response.status).toBe(200);
    firstContentType = response.headers.get('content-type') ?? '';
    first = readOrganizationsPage(body);
  });

  it('responde em JSON no envelope esperado', () => {
    expect(firstContentType).toMatch(/json/i);
  });

  // O bug que escapou dos e2e: a rota errada devolvia só 10 de mais de mil.
  it('honra o tamanho de página pedido, e não uma amostra', () => {
    expect(first.total).toBeGreaterThan(GHG_ORGANIZATIONS_PAGE_SIZE);
    expect(first.organizations).toHaveLength(GHG_ORGANIZATIONS_PAGE_SIZE);
  });

  it('pagina: a página seguinte traz organizações novas', async () => {
    const { body } = await searchPage(GHG_ORGANIZATIONS_PAGE_SIZE);
    const second = readOrganizationsPage(body);
    const seen = new Set(first.organizations.map(({ id }) => id));

    expect(second.organizations.length).toBeGreaterThan(0);
    expect(second.organizations.some(({ id }) => seen.has(id))).toBe(false);
  });

  it('publica inventário e relatório em PDF que o leitor identifica', async () => {
    let found: { id: number; cycleId: number; year: number } | null = null;

    for (const { id } of first.organizations.slice(0, INVENTORY_PROBES)) {
      const response = await callSource(
        `${joinUrl(apiBase(), [...GHG_PUBLIC_API, 'GetReportedInventories'])}?organizationId=${id}`,
      );

      expect(response.status).toBe(200);
      const latest = readInventories(await response.json()).sort(
        (a, b) => b.year - a.year,
      )[0];

      if (latest) {
        found = { id, ...latest };
        break;
      }
    }

    expect(found).not.toBeNull();
    const { id, cycleId, year } = found!;
    const report = await callSource(
      joinUrl(reportBase(), [
        'GenerateReport',
        'GenerateInventoryReport',
        String(id),
        String(cycleId),
        'true',
      ]),
      {},
      120_000,
    );

    expect(report.status).toBe(200);
    const bytes = Buffer.from(await report.arrayBuffer());

    expect(bytes.length).toBeLessThan(MAX_REPORT_BYTES);
    expect(bytes.subarray(0, 4).toString('latin1')).toBe('%PDF');

    const directory = await mkdtemp(join(tmpdir(), 'bios-contract-ghg-'));

    try {
      const path = join(directory, 'report.pdf');
      await writeFile(path, bytes);
      const identity = await new GhgReportReader().read(path, 60_000);

      expect(identity).not.toBeNull();
      expect(identity?.year).toBe(year);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

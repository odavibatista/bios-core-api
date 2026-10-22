import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ghgPdf,
  ghgInventoryFactory,
} from '@test/factories/ghg/ghg.factory.js';
import { faker } from '@test/support/faker.js';
import { GhgReportReader } from './ghg-report-reader.provider.js';
describe('PDF GHG em thread limitada', () => {
  let dir: string;
  const reader = new GhgReportReader(),
    inventory = ghgInventoryFactory.build();
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ghg-reader-test-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  it('le PDF sintetico real e descarta contato', async () => {
    const file = join(dir, 'synthetic.pdf');
    await writeFile(
      file,
      ghgPdf(inventory.cnpj, inventory.year, faker.internet.email()),
    );
    expect(await reader.read(file, 10000)).toEqual({
      cnpj: inventory.cnpj,
      year: inventory.year,
    });
  });
  it('prazo zero nao inicia parser', async () => {
    expect(await reader.read(join(dir, 'missing'), 0)).toBeNull();
  });
  it('timeout termina a thread e volta sem texto', async () => {
    expect(await reader.read(join(dir, 'missing'), 1)).toBeNull();
  });
  it('arquivo invalido/ausente nao vaza erro', async () => {
    const path = join(dir, 'bad');
    await writeFile(path, '<html>');
    expect(await reader.read(path, 10000)).toBeNull();
    expect(await reader.read(join(dir, 'missing'), 10000)).toBeNull();
  });
});

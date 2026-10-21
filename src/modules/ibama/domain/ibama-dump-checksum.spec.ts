import { buildChecksum } from '@test/factories/data-sources/ingestion-run.factory.js';
import { combineDumpChecksums } from './ibama-dump-checksum.js';
import { IbamaResource } from './ibama-resource.js';

describe('combineDumpChecksums', () => {
  const autos = {
    resource: IbamaResource.AUTO_INFRACAO,
    checksum: buildChecksum(),
  };
  const embargos = {
    resource: IbamaResource.TERMO_EMBARGO,
    checksum: buildChecksum(),
  };

  it('é um SHA-256 em hexadecimal', () => {
    expect(combineDumpChecksums([autos, embargos])).toMatch(/^[0-9a-f]{64}$/);
  });

  it('é determinístico: os mesmos dumps dão o mesmo checksum', () => {
    expect(combineDumpChecksums([autos, embargos])).toBe(
      combineDumpChecksums([{ ...autos }, { ...embargos }]),
    );
  });

  it('não depende da ordem em que os dumps foram baixados', () => {
    expect(combineDumpChecksums([autos, embargos])).toBe(
      combineDumpChecksums([embargos, autos]),
    );
  });

  it('muda quando só o dump de autos de infração muda', () => {
    expect(
      combineDumpChecksums([{ ...autos, checksum: buildChecksum() }, embargos]),
    ).not.toBe(combineDumpChecksums([autos, embargos]));
  });

  it('muda quando só o dump de termos de embargo muda', () => {
    expect(
      combineDumpChecksums([autos, { ...embargos, checksum: buildChecksum() }]),
    ).not.toBe(combineDumpChecksums([autos, embargos]));
  });

  it('não confunde um arquivo trocado pelo outro', () => {
    expect(
      combineDumpChecksums([
        { resource: IbamaResource.AUTO_INFRACAO, checksum: embargos.checksum },
        { resource: IbamaResource.TERMO_EMBARGO, checksum: autos.checksum },
      ]),
    ).not.toBe(combineDumpChecksums([autos, embargos]));
  });
});

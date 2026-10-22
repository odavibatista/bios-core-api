import { GetIbamaCompanyEvidencesUseCase } from '@modules/ibama/infra/usecases/get-ibama-company-evidences.usecase.js';
import { GetGhgCompanyEvidencesUseCase } from '@modules/ghg/infra/usecases/get-ghg-company-evidences.usecase.js';
import { storedEvidenceFactory } from '@test/factories/evidences/evidence.factory.js';
import { buildCnpj } from '@test/factories/companies/company-profile.factory.js';
import { RequestCguCompanyEvidencesUseCase } from './request-cgu-company-evidences.usecase.js';
import { ListCompanyEvidencesUseCase } from './list-company-evidences.usecase.js';
import { RecordEvidenceCollectionUseCase } from './record-evidence-collection.usecase.js';
import { GetCompanyEnvironmentalEvidencesUseCase } from './get-company-environmental-evidences.usecase.js';
import { Test } from '@nestjs/testing';
describe('UC07 fontes independentes', () => {
  const ibama = { execute: vi.fn() },
    cgu = { execute: vi.fn() },
    ghg = { execute: vi.fn() },
    list = { execute: vi.fn() },
    collection = {
      execute: vi.fn<RecordEvidenceCollectionUseCase['execute']>(),
    };
  const cnpj = buildCnpj();
  let useCase: GetCompanyEnvironmentalEvidencesUseCase;
  beforeEach(async () => {
    vi.resetAllMocks();
    for (const mock of [ibama, cgu, ghg]) mock.execute.mockResolvedValue([]);
    list.execute.mockResolvedValue([storedEvidenceFactory.build({ cnpj })]);
    const module = await Test.createTestingModule({
      providers: [
        GetCompanyEnvironmentalEvidencesUseCase,
        { provide: GetIbamaCompanyEvidencesUseCase, useValue: ibama },
        { provide: RequestCguCompanyEvidencesUseCase, useValue: cgu },
        { provide: GetGhgCompanyEvidencesUseCase, useValue: ghg },
        { provide: ListCompanyEvidencesUseCase, useValue: list },
        { provide: RecordEvidenceCollectionUseCase, useValue: collection },
      ],
    }).compile();
    useCase = module.get(GetCompanyEnvironmentalEvidencesUseCase);
  });
  it('inicia todas as fontes antes de esperar e rele o estado persistido', async () => {
    let resolve!: () => void;
    ibama.execute.mockImplementation(
      () =>
        new Promise<void>((r) => {
          resolve = r;
        }),
    );
    const pending = useCase.execute(cnpj);
    await Promise.resolve();
    expect(cgu.execute).toHaveBeenCalledWith(cnpj);
    expect(ghg.execute).toHaveBeenCalledWith(cnpj);
    expect(list.execute).not.toHaveBeenCalled();
    resolve();
    const result = await pending;
    expect(result.cnpj).toBe(cnpj);
    expect(result.categories.flatMap((g) => g.evidences)).toHaveLength(1);
    expect(collection.execute).not.toHaveBeenCalled();
  });
  it.each([
    ['IBAMA', ['IBAMA']],
    ['CGU', ['CGU_CEIS', 'CGU_CNEP']],
    ['GHG', ['GHG_PROTOCOL']],
  ] as const)('queda %s conserva outras fontes', async (name, slugs) => {
    ({ IBAMA: ibama, CGU: cgu, GHG: ghg })[name].execute.mockRejectedValue(
      new Error('fonte fora'),
    );
    const result = await useCase.execute(cnpj);
    expect(
      collection.execute.mock.calls.map(([arg]) => arg.sourceSlug),
    ).toEqual([...slugs]);
    for (const sourceSlug of slugs)
      expect(collection.execute).toHaveBeenCalledWith({
        cnpj,
        sourceSlug,
        result: { status: 'UNAVAILABLE' },
      });
    expect(result.categories.flatMap((g) => g.evidences)).toHaveLength(1);
  });
  it('recusa CNPJ invalido antes de publicar ou consultar', async () => {
    await expect(useCase.execute('invalido')).rejects.toThrow(/CNPJ/);
    expect(ibama.execute).not.toHaveBeenCalled();
    expect(list.execute).not.toHaveBeenCalled();
  });
  it('nao disfarca falha global de persistencia como ausencia', async () => {
    list.execute.mockRejectedValue(new Error('banco fora'));
    await expect(useCase.execute(cnpj)).rejects.toThrow('banco fora');
  });
});

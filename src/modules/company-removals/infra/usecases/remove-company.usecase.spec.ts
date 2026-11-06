import { Test } from '@nestjs/testing';
import { InvalidCnpjException } from '@modules/companies/domain/dtos/errors/invalid-cnpj.exception.js';
import { CacheNamespace } from '@shared/domain/dtos/providers/cache-key.dto.js';
import { CacheProvider } from '@shared/domain/providers/cache.provider.js';
import { buildCnpj } from '@test/factories/companies/company-profile.factory.js';
import { CompanyRemovalRepository } from '../../domain/dtos/repositories/company-removal.repository.js';
import { RemoveCompanyUseCase } from './remove-company.usecase.js';

describe('RemoveCompanyUseCase', () => {
  const removals = { remove: vi.fn<CompanyRemovalRepository['remove']>() };
  const cache = { delete: vi.fn<CacheProvider['delete']>() };
  const removedAt = new Date('2026-11-05T12:00:00.000Z');
  let useCase: RemoveCompanyUseCase;

  beforeEach(async () => {
    cache.delete.mockResolvedValue(undefined);

    const moduleRef = await Test.createTestingModule({
      providers: [
        RemoveCompanyUseCase,
        { provide: CompanyRemovalRepository, useValue: removals },
        { provide: CacheProvider, useValue: cache },
      ],
    }).compile();

    useCase = moduleRef.get(RemoveCompanyUseCase);
  });

  it('retira o cadastro e descarta as cópias em cache', async () => {
    const cnpj = buildCnpj();
    removals.remove.mockResolvedValue({ cnpj, removedAt });

    await expect(useCase.execute(cnpj)).resolves.toEqual({
      cnpj,
      removed_at: removedAt.toISOString(),
    });

    expect(removals.remove).toHaveBeenCalledWith(cnpj);
    expect(cache.delete.mock.calls.map(([key]) => key)).toEqual([
      { namespace: CacheNamespace.COMPANY_PROFILE, identifier: cnpj },
      { namespace: CacheNamespace.COMPANY_EVIDENCES, identifier: cnpj },
      { namespace: CacheNamespace.COMPANY_SCORES, identifier: cnpj },
      { namespace: CacheNamespace.COMPANY_ANALYTICS, identifier: 'base' },
    ]);
  });

  it('recusa CNPJ inválido sem tocar em nada', async () => {
    await expect(useCase.execute('invalido')).rejects.toBeInstanceOf(
      InvalidCnpjException,
    );

    expect(removals.remove).not.toHaveBeenCalled();
  });
});

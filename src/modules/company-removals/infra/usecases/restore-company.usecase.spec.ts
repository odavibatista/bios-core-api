import { Test } from '@nestjs/testing';
import { InvalidCnpjException } from '@modules/companies/domain/dtos/errors/invalid-cnpj.exception.js';
import { buildCnpj } from '@test/factories/companies/company-profile.factory.js';
import { CompanyRemovalNotFoundException } from '../../domain/dtos/errors/company-removal.errors.js';
import { CompanyRemovalRepository } from '../../domain/dtos/repositories/company-removal.repository.js';
import { RestoreCompanyUseCase } from './restore-company.usecase.js';

describe('RestoreCompanyUseCase', () => {
  const removals = { restore: vi.fn<CompanyRemovalRepository['restore']>() };
  let useCase: RestoreCompanyUseCase;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        RestoreCompanyUseCase,
        { provide: CompanyRemovalRepository, useValue: removals },
      ],
    }).compile();

    useCase = moduleRef.get(RestoreCompanyUseCase);
  });

  it('tira o CNPJ da lista', async () => {
    const cnpj = buildCnpj();
    removals.restore.mockResolvedValue(true);

    await expect(useCase.execute(cnpj)).resolves.toBeUndefined();

    expect(removals.restore).toHaveBeenCalledWith(cnpj);
  });

  it('CNPJ fora da lista responde 404', async () => {
    removals.restore.mockResolvedValue(false);

    await expect(useCase.execute(buildCnpj())).rejects.toBeInstanceOf(
      CompanyRemovalNotFoundException,
    );
  });

  it('recusa CNPJ inválido', async () => {
    await expect(useCase.execute('invalido')).rejects.toBeInstanceOf(
      InvalidCnpjException,
    );
  });
});

import { Test } from '@nestjs/testing';
import { DataSourceRepository } from '../../../domain/dtos/repositories/data-source.repository.js';
import { ResolveSourceRequestConfigUseCase } from './resolve-source-request-config.usecase.js';

it('resolve habilitação pelo contrato público do catálogo, inclusive fonte ausente', async () => {
  const findRequestConfig = vi.fn().mockResolvedValue(null);
  const module = await Test.createTestingModule({
    providers: [
      ResolveSourceRequestConfigUseCase,
      { provide: DataSourceRepository, useValue: { findRequestConfig } },
    ],
  }).compile();
  const useCase = module.get(ResolveSourceRequestConfigUseCase);
  await expect(useCase.execute('CGU_CEIS')).resolves.toBeNull();
  expect(findRequestConfig).toHaveBeenCalledWith('CGU_CEIS');
});

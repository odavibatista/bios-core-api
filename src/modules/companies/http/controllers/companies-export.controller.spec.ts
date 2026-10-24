import { StreamableFile } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { IS_PUBLIC_ROUTE } from '@shared/http/decorators/public.decorator.js';
import {
  ExportCompaniesUseCase,
  XLSX_CONTENT_TYPE,
} from '../../infra/usecases/export-companies.usecase.js';
import { CompaniesExportController } from './companies-export.controller.js';

describe('CompaniesExportController', () => {
  const exportCompanies = { execute: vi.fn() };
  let controller: CompaniesExportController;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [CompaniesExportController],
      providers: [
        { provide: ExportCompaniesUseCase, useValue: exportCompanies },
      ],
    }).compile();

    controller = moduleRef.get(CompaniesExportController);
  });

  it('entrega os critérios ao caso de uso e devolve o arquivo como anexo XLSX', async () => {
    const content = Buffer.from('conteudo');
    exportCompanies.execute.mockResolvedValue({
      content,
      fileName: 'empresas-bios-2026-10-24.xlsx',
      companies: 3,
    });
    const query = { uf: 'SP' as const, ods: 15, order: 'desc' as const };

    const file = await controller.exportCompanies(query);

    expect(exportCompanies.execute).toHaveBeenCalledWith(query);
    expect(file).toBeInstanceOf(StreamableFile);
    expect(file.options).toMatchObject({
      type: XLSX_CONTENT_TYPE,
      disposition: 'attachment; filename="empresas-bios-2026-10-24.xlsx"',
      length: content.length,
    });
  });

  it('propaga a recusa do caso de uso', async () => {
    exportCompanies.execute.mockRejectedValue(new Error('sem resultados'));

    await expect(
      controller.exportCompanies({ uf: 'AM' as const }),
    ).rejects.toThrow('sem resultados');
  });

  it('exige sessão: a exportação não é pública', () => {
    const reflector = new Reflector();

    expect(
      reflector.get<boolean | undefined>(
        IS_PUBLIC_ROUTE,
        CompaniesExportController.prototype.exportCompanies,
      ),
    ).toBeUndefined();
    expect(
      reflector.get<boolean | undefined>(
        IS_PUBLIC_ROUTE,
        CompaniesExportController,
      ),
    ).toBeUndefined();
  });
});

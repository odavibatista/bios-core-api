import { OdsNotAvailableException } from '@modules/scoring/domain/dtos/errors/ods-not-available.errors.js';
import { readXlsx } from '@test/support/xlsx-reader.js';
import {
  ExportTooLargeException,
  NoResultsToExportException,
} from '../../domain/dtos/errors/export-companies.errors.js';
import type { CompanyProfileRepository } from '../../domain/dtos/repositories/company-profile.repository.js';
import type { CompanySearchItem } from '../../domain/dtos/requests/search-companies.dto.js';
import { ExportCompaniesUseCase } from './export-companies.usecase.js';

/** Teto configurado nesta suíte (`EXPORT_MAX_COMPANIES`); o padrão de produção é 5000. */
const EXPORT_MAX_COMPANIES = 40;

describe('ExportCompaniesUseCase', () => {
  const repository = {
    search: vi.fn<CompanyProfileRepository['search']>(),
  };
  const listScores = { execute: vi.fn() };
  const ensureActiveOds = { execute: vi.fn() };
  const config = { get: vi.fn() };
  let useCase: ExportCompaniesUseCase;

  function item(cnpj: string, legalName: string): CompanySearchItem {
    return {
      cnpj,
      legal_name: legalName,
      trade_name: null,
      registration_status: 'ATIVA',
      city: 'SAO PAULO',
      uf: 'SP',
      main_cnae: { code: '6201501', description: 'DESENVOLVIMENTO' },
      ods_score: null,
    };
  }

  beforeEach(() => {
    config.get.mockImplementation((key: string) =>
      key === 'EXPORT_MAX_COMPANIES' ? EXPORT_MAX_COMPANIES : undefined,
    );
    repository.search.mockResolvedValue({
      items: [item('11222333000181', 'ACME'), item('00000000000191', 'BETA')],
      total: 2,
    });
    listScores.execute.mockResolvedValue({
      odsNumbers: [13, 15],
      summaries: [
        {
          cnpj: '11222333000181',
          odsNumber: 13,
          scoreValue: 60,
          confidenceValue: 0.2,
        },
        {
          cnpj: '11222333000181',
          odsNumber: 15,
          scoreValue: -45,
          confidenceValue: 0.8,
        },
        {
          cnpj: '00000000000191',
          odsNumber: 15,
          scoreValue: null,
          confidenceValue: 0,
        },
      ],
    });
    useCase = new ExportCompaniesUseCase(
      repository as never,
      listScores as never,
      ensureActiveOds as never,
      config as never,
    );
  });

  it('procura com os critérios da pesquisa, sem paginação, até o limite da exportação', async () => {
    await useCase.execute({
      name: 'acme',
      uf: 'SP',
      cnae: '62',
      ods: 15,
      min_score: -50,
      order: 'asc',
    });

    expect(repository.search).toHaveBeenCalledWith({
      nameTerms: ['ACME'],
      uf: 'SP',
      cnaePrefix: '62',
      ods: { number: 15, minScore: -50, order: 'asc' },
      skip: 0,
      take: EXPORT_MAX_COMPANIES,
    });
  });

  it('confere o ODS escolhido antes de procurar', async () => {
    await useCase.execute({ ods: 15 });

    expect(ensureActiveOds.execute).toHaveBeenCalledWith(15);
  });

  it('ODS que o BIOS não calcula: 422 sem procurar nem montar planilha', async () => {
    ensureActiveOds.execute.mockRejectedValue(
      new OdsNotAvailableException(7, [13, 15]),
    );

    await expect(useCase.execute({ ods: 7 })).rejects.toBeInstanceOf(
      OdsNotAvailableException,
    );
    expect(repository.search).not.toHaveBeenCalled();
    expect(listScores.execute).not.toHaveBeenCalled();
  });

  it('sem ODS, não consulta o catálogo', async () => {
    await useCase.execute({ uf: 'SP' });

    expect(ensureActiveOds.execute).not.toHaveBeenCalled();
  });

  it('pede os índices das empresas da lista, e só delas', async () => {
    await useCase.execute({ uf: 'SP' });

    expect(listScores.execute).toHaveBeenCalledWith([
      '11222333000181',
      '00000000000191',
    ]);
  });

  it('gera a planilha com uma linha por empresa, na ordem da pesquisa, e os índices por ODS', async () => {
    const { content, companies } = await useCase.execute({ uf: 'SP' });
    const { rows } = readXlsx(content);

    expect(companies).toBe(2);
    expect(rows[0].slice(8)).toEqual([
      'ODS 13 - Índice',
      'ODS 13 - Confiança',
      'ODS 15 - Índice',
      'ODS 15 - Confiança',
    ]);
    expect(rows[1].slice(0, 2)).toEqual(['11222333000181', 'ACME']);
    expect(rows[1].slice(8)).toEqual([60, 0.2, -45, 0.8]);
    expect(rows[2].slice(0, 2)).toEqual(['00000000000191', 'BETA']);
    expect(rows[2].slice(8)).toEqual([null, null, null, 0]);
  });

  it('o nome do arquivo leva a data do dia e a extensão xlsx', async () => {
    const { fileName } = await useCase.execute({ uf: 'SP' });

    expect(fileName).toMatch(/^empresas-bios-\d{4}-\d{2}-\d{2}\.xlsx$/);
  });

  it('sem nenhuma empresa que atenda aos critérios, recusa em vez de gerar planilha vazia', async () => {
    repository.search.mockResolvedValue({ items: [], total: 0 });

    await expect(useCase.execute({ uf: 'AM' })).rejects.toBeInstanceOf(
      NoResultsToExportException,
    );
    expect(listScores.execute).not.toHaveBeenCalled();
  });

  it('acima do limite, recusa e diz quantas empresas são', async () => {
    repository.search.mockResolvedValue({
      items: [item('11222333000181', 'ACME')],
      total: EXPORT_MAX_COMPANIES + 1,
    });

    const error = await useCase.execute({ uf: 'SP' }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ExportTooLargeException);
    expect((error as ExportTooLargeException).details).toEqual({
      total: EXPORT_MAX_COMPANIES + 1,
      max: EXPORT_MAX_COMPANIES,
    });
    expect(listScores.execute).not.toHaveBeenCalled();
  });

  it('o teto vem da configuração: outro valor muda a janela pedida e o ponto da recusa', async () => {
    config.get.mockImplementation((key: string) =>
      key === 'EXPORT_MAX_COMPANIES' ? 7 : undefined,
    );
    repository.search.mockResolvedValue({
      items: [item('11222333000181', 'ACME')],
      total: 8,
    });

    const error = await useCase.execute({ uf: 'SP' }).catch((e: unknown) => e);

    expect(repository.search).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 0, take: 7 }),
    );
    expect((error as ExportTooLargeException).details).toEqual({
      total: 8,
      max: 7,
    });
    expect((error as ExportTooLargeException).message).toContain('até 7');
  });

  it('no limite exato, exporta', async () => {
    repository.search.mockResolvedValue({
      items: [item('11222333000181', 'ACME')],
      total: EXPORT_MAX_COMPANIES,
    });

    await expect(useCase.execute({ uf: 'SP' })).resolves.toMatchObject({
      companies: 1,
    });
  });

  it('empresa sem nenhum índice sai com as células de índice vazias', async () => {
    listScores.execute.mockResolvedValue({
      odsNumbers: [13, 15],
      summaries: [],
    });

    const { rows } = readXlsx((await useCase.execute({ uf: 'SP' })).content);

    expect(rows[1].slice(8)).toEqual([null, null, null, null]);
  });

  it('propaga a falha do banco', async () => {
    repository.search.mockRejectedValue(new Error('banco fora'));

    await expect(useCase.execute({ uf: 'SP' })).rejects.toThrow('banco fora');
  });
});

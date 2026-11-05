import { HttpException, HttpStatus } from '@nestjs/common';
import { EvidenceCategory, EvidenceState } from '@prisma/client';
import { Test } from '@nestjs/testing';
import { buildCnpj } from '@test/factories/companies/company-profile.factory.js';
import { companyFullProfileResponseFactory } from '@test/factories/companies/company-full-profile.factory.js';
import type { CompanyFullProfileResponse } from '../../domain/dtos/requests/company-full-profile.dto.js';
import {
  CrmAccountSchema,
  CrmImportStatus,
} from '../../domain/dtos/requests/crm-import.dto.js';
import { GetCompanyFullProfileUseCase } from './get-company-full-profile.usecase.js';
import { ImportCrmAccountsUseCase } from './import-crm-accounts.usecase.js';

/** O caso de uso só repassa o CNPJ: aqui basta que sejam diferentes. */
const distinctCnpjs = (size: number) =>
  Array.from({ length: size }, (_, index) => `1122233300018${index}`);

describe('ImportCrmAccountsUseCase', () => {
  const getFullProfile = { execute: vi.fn() };
  let useCase: ImportCrmAccountsUseCase;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        ImportCrmAccountsUseCase,
        { provide: GetCompanyFullProfileUseCase, useValue: getFullProfile },
      ],
    }).compile();

    useCase = moduleRef.get(ImportCrmAccountsUseCase);
  });

  it('monta a conta no formato de importação, sem esperar as fontes externas', async () => {
    const cnpj = buildCnpj();
    const profile: CompanyFullProfileResponse = {
      ...companyFullProfileResponseFactory.build(),
      evidences: [
        {
          category: EvidenceCategory.INFRACAO_AMBIENTAL,
          evidences: [
            { state: EvidenceState.CONFIRMED },
            { state: EvidenceState.NOT_FOUND },
          ],
        },
      ] as CompanyFullProfileResponse['evidences'],
    };
    getFullProfile.execute.mockResolvedValue(profile);

    const { data } = await useCase.execute({ cnpjs: [cnpj] });

    expect(getFullProfile.execute).toHaveBeenCalledWith(cnpj, {
      waitForCollection: false,
    });
    expect(data[0]).toMatchObject({
      cnpj,
      status: CrmImportStatus.IMPORTED,
      account: {
        external_id: profile.cnpj,
        city: profile.address.city,
        uf: profile.address.uf,
        main_cnae_code: profile.main_cnae.code,
        evidences: [
          {
            category: EvidenceCategory.INFRACAO_AMBIENTAL,
            confirmed_count: 1,
          },
        ],
      },
    });
    expect(CrmAccountSchema.safeParse(data[0]?.account).success).toBe(true);
  });

  it('não leva endereço de rua, CEP nem explicação do índice (LGPD, art. 6º, III)', async () => {
    const profile = companyFullProfileResponseFactory.build();
    getFullProfile.execute.mockResolvedValue(profile);

    const { data } = await useCase.execute({ cnpjs: [buildCnpj()] });
    const account = JSON.stringify(data[0]?.account);

    for (const field of ['street', 'number', 'complement', 'zipcode']) {
      expect(account).not.toContain(`"${field}"`);
    }
    expect(account).not.toContain('contributions');
    expect(account).not.toContain('"sources"');
  });

  it('cada CNPJ tem seu estado, e uma falha não derruba as demais contas', async () => {
    const [found, missing, invalid, offline] = distinctCnpjs(4);
    const failures: Record<string, HttpStatus> = {
      [missing]: HttpStatus.NOT_FOUND,
      [invalid]: HttpStatus.UNPROCESSABLE_ENTITY,
      [offline]: HttpStatus.SERVICE_UNAVAILABLE,
    };
    getFullProfile.execute.mockImplementation((cnpj: string) => {
      const status = failures[cnpj];

      return status
        ? Promise.reject(new HttpException('falhou', status))
        : Promise.resolve(companyFullProfileResponseFactory.build());
    });

    const { data } = await useCase.execute({
      cnpjs: [found, missing, invalid, offline] as string[],
    });

    expect(data.map(({ cnpj, status }) => [cnpj, status])).toEqual([
      [found, CrmImportStatus.IMPORTED],
      [missing, CrmImportStatus.NOT_FOUND],
      [invalid, CrmImportStatus.INVALID],
      [offline, CrmImportStatus.UNAVAILABLE],
    ]);
    expect(data.slice(1).map(({ account }) => account)).toEqual([
      null,
      null,
      null,
    ]);
  });

  it('CNPJ repetido conta uma vez, e a ordem enviada se mantém além da concorrência', async () => {
    const cnpjs = distinctCnpjs(7);
    getFullProfile.execute.mockResolvedValue(
      companyFullProfileResponseFactory.build(),
    );

    const { data } = await useCase.execute({
      cnpjs: [...cnpjs, cnpjs[0]],
    });

    expect(data.map(({ cnpj }) => cnpj)).toEqual(cnpjs);
    expect(getFullProfile.execute).toHaveBeenCalledTimes(7);
  });

  it('erro que não veio do domínio é defeito e sobe', async () => {
    getFullProfile.execute.mockRejectedValue(new TypeError('defeito'));

    await expect(useCase.execute({ cnpjs: [buildCnpj()] })).rejects.toThrow(
      'defeito',
    );
  });
});

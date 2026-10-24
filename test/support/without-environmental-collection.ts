import type { TestingModuleBuilder } from '@nestjs/testing';
import { GetCompanyEnvironmentalEvidencesUseCase } from '@modules/environmental-intelligence/infra/usecases/get-company-environmental-evidences.usecase.js';
import { groupCompanyEvidences } from '@modules/evidences/domain/company-environmental-evidences.dto.js';

/**
 * Impede que a consulta do perfil dispare coletas nas fontes ambientais.
 *
 * O perfil completo (UC06 + UC07) consolida IBAMA, CGU e GHG ao ser consultado. Os testes
 * que exercitam só o cadastro, a autenticação ou o limite de requisições não querem
 * baixar os dumps do IBAMA nem falar com as fontes: trocam a consolidação por uma que
 * devolve as evidências sem coletar nada. Os testes do perfil completo não usam isto.
 */
export function withoutEnvironmentalCollection(
  builder: TestingModuleBuilder,
): void {
  builder.overrideProvider(GetCompanyEnvironmentalEvidencesUseCase).useValue({
    execute: (cnpj: string) => Promise.resolve(groupCompanyEvidences(cnpj, [])),
  });
}

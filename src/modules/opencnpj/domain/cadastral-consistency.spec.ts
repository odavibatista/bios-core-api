import { toCadastralRecord as fromReceitaFormat } from '@modules/data-sources/domain/receita-open-data.mapper.js';
import { openCnpjFactory } from '@test/factories/data-sources/opencnpj-cnpj.factory.js';
import { receitaOpenDataCnpjFactory } from '@test/factories/data-sources/receita-open-data-cnpj.factory.js';
import { toCadastralRecord as fromOpenCnpj } from './opencnpj-cnpj.mapper.js';

const CNPJ = '11222333000181';

/**
 * A cadeia de fallback só é transparente se a mesma empresa resultar no mesmo
 * cadastro, não importa qual provedor respondeu: do contrário, trocar de
 * provedor mudaria o `content_hash` (que detecta mudança cadastral) sem a
 * empresa ter mudado.
 */
describe('consistência entre provedores cadastrais', () => {
  const company = {
    razaoSocial: 'ACME SERVICOS LTDA',
    fantasia: 'ACME',
  };

  const receitaFormat = receitaOpenDataCnpjFactory.build({
    razao_social: company.razaoSocial,
    nome_fantasia: company.fantasia,
  });
  const openCnpj = openCnpjFactory.build({
    razao_social: company.razaoSocial,
    nome_fantasia: company.fantasia,
  });

  it('a mesma empresa vira o mesmo cadastro, salvo o código IBGE que só um provedor informa', () => {
    const fromReceita = fromReceitaFormat(receitaFormat, CNPJ);
    const fromOpen = fromOpenCnpj(openCnpj, CNPJ);

    expect(fromReceita).not.toBeNull();
    expect(fromOpen).toEqual({
      ...fromReceita,
      address: { ...fromReceita?.address, cityIbgeCode: null },
    });
  });

  it('o porte vem na mesma grafia, escrito como cada provedor o escreve', () => {
    const sizes = [
      ['DEMAIS', 'Demais'],
      ['MICRO EMPRESA', 'Microempresa'],
      ['EMPRESA DE PEQUENO PORTE', 'EMPRESA DE PEQUENO PORTE'],
    ] as const;

    for (const [inReceita, inOpenCnpj] of sizes) {
      expect(
        fromReceitaFormat({ ...receitaFormat, porte: inReceita }, CNPJ)
          ?.companySize,
      ).toBe(
        fromOpenCnpj({ ...openCnpj, porte_empresa: inOpenCnpj }, CNPJ)
          ?.companySize,
      );
    }
  });

  it('a situação cadastral vem na mesma grafia', () => {
    expect(
      fromReceitaFormat(
        { ...receitaFormat, descricao_situacao_cadastral: 'BAIXADA' },
        CNPJ,
      )?.registrationStatus,
    ).toBe(
      fromOpenCnpj({ ...openCnpj, situacao_cadastral: 'Baixada' }, CNPJ)
        ?.registrationStatus,
    );
  });
});

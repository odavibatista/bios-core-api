import { Injectable, Logger } from '@nestjs/common';
import { RequestTrigger } from '@prisma/client';
import type {
  CadastralCnae,
  CadastralRecord,
} from '@modules/data-sources/domain/dtos/providers/cadastral-record.dto.js';
import { ReceitaDataSource } from '@modules/receita/infra/providers/receita.data-source.js';
import { CacheNamespace } from '@shared/domain/dtos/providers/cache-key.dto.js';
import { UseCase } from '@shared/domain/protocols/use-case.protocol.js';
import { CacheProvider } from '@shared/domain/providers/cache.provider.js';
import { computeCadastralContentHash } from '../../domain/cadastral-content-hash.js';
import type { CompanyProfileJobResult } from '../../domain/dtos/providers/company-profile-job.dto.js';
import {
  CompanyProfileRepository,
  type StoredCompanyProfile,
} from '../../domain/dtos/repositories/company-profile.repository.js';
import {
  maskPersonalIdentifiers,
  maskPersonalIdentifiersOrNull,
} from '../../domain/mask-personal-identifiers.js';
import { ResolveCnaeDescriptionsUseCase } from './resolve-cnae-descriptions.usecase.js';

/**
 * Atualiza o cadastro de uma empresa e o grava em `company_profile` (RF03,
 * RF05, RF06).
 *
 * Percorre a cadeia de provedores (`ReceitaDataSource`) e, com o cadastro em
 * mãos:
 *  1. troca a descrição dos CNAEs pela oficial do IBGE, quando disponível, para
 *     que a mesma atividade tenha o mesmo texto qualquer que seja o provedor;
 *  2. mascara o CPF que a razão social de empresário individual e de MEI
 *     carrega (INL02);
 *  3. calcula o hash do conteúdo e, se ele mudou, guarda o anterior em
 *     `previous_content_hash`;
 *  4. grava e descarta a cópia em cache, para a próxima leitura trazer o dado
 *     novo.
 *
 * O resultado segue o contrato da fila (`CompanyProfileJobResult`).
 * "Provedores indisponíveis" é **resultado**, e não erro: quem espera é um
 * usuário, e repetir por trás dele não ajuda. Já uma falha ao gravar propaga:
 * é problema nosso, e a fila repete.
 */
@Injectable()
export class RefreshCompanyProfileUseCase extends UseCase<
  string,
  CompanyProfileJobResult
> {
  private readonly logger = new Logger(RefreshCompanyProfileUseCase.name);

  constructor(
    private readonly receitaDataSource: ReceitaDataSource,
    private readonly resolveCnaeDescriptionsUseCase: ResolveCnaeDescriptionsUseCase,
    private readonly companyProfileRepository: CompanyProfileRepository,
    private readonly cacheProvider: CacheProvider,
  ) {
    super();
  }

  override async execute(cnpj: string): Promise<CompanyProfileJobResult> {
    const context = { trigger: RequestTrigger.ON_DEMAND_JOB };
    const lookup = await this.receitaDataSource.fetch(cnpj, context);

    if (lookup.status === 'NOT_FOUND') return { outcome: 'NOT_FOUND' };

    if (lookup.status === 'UNAVAILABLE') {
      this.logger.warn(
        `Provedores cadastrais indisponíveis para ${cnpj}: ${lookup.message ?? lookup.reason}`,
      );

      return { outcome: 'SOURCES_UNAVAILABLE' };
    }

    const { record, sourceSlug } = lookup.data;
    const stored = await this.companyProfileRepository.findByCnpj(cnpj);
    const descriptions = await this.resolveCnaeDescriptionsUseCase.execute({
      codes: [record.mainCnae, ...record.secondaryCnaes].map(
        ({ code }) => code,
      ),
      context,
    });
    const prepared = this.prepare(record, descriptions, stored);
    const contentHash = computeCadastralContentHash(prepared);

    await this.companyProfileRepository.save({
      record: prepared,
      sourceSlug,
      contentHash,
      previousContentHash: previousHashOf(stored, contentHash),
      refreshedAt: new Date(),
    });
    await this.cacheProvider.delete({
      namespace: CacheNamespace.COMPANY_PROFILE,
      identifier: cnpj,
    });

    return { outcome: 'FOUND' };
  }

  /** O cadastro como será gravado: descrições oficiais, sem CPF, com o código IBGE preservado. */
  private prepare(
    record: CadastralRecord,
    descriptions: ReadonlyMap<string, string>,
    stored: StoredCompanyProfile | null,
  ): CadastralRecord {
    const describe = ({ code, description }: CadastralCnae): CadastralCnae => ({
      code,
      description: descriptions.get(code) ?? description,
    });

    return {
      ...record,
      legalName: maskPersonalIdentifiers(record.legalName),
      tradeName: maskPersonalIdentifiersOrNull(record.tradeName),
      address: {
        ...record.address,
        cityIbgeCode:
          record.address.cityIbgeCode ?? keptIbgeCode(record, stored),
      },
      mainCnae: describe(record.mainCnae),
      secondaryCnaes: record.secondaryCnaes.map(describe),
    };
  }
}

/**
 * Hash a guardar como "anterior". Se o conteúdo mudou, é o hash que estava
 * gravado; se não mudou, fica o que já era o anterior — reatualizar um
 * cadastro igual não apaga o histórico da última mudança.
 */
function previousHashOf(
  stored: StoredCompanyProfile | null,
  newHash: string,
): string | null {
  if (!stored) return null;

  return stored.contentHash === newHash
    ? stored.previousContentHash
    : stored.contentHash;
}

/**
 * Código IBGE já conhecido do município, para quando o provedor que respondeu
 * agora (o OpenCNPJ) não o informa. Só vale para o mesmo município: se a
 * empresa mudou de cidade, o código antigo não é dela.
 */
function keptIbgeCode(
  record: CadastralRecord,
  stored: StoredCompanyProfile | null,
): string | null {
  const previous = stored?.profile.address;

  return previous &&
    previous.city === record.address.city &&
    previous.uf === record.address.uf
    ? previous.city_ibge_code
    : null;
}

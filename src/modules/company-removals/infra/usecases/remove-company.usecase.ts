import { Injectable } from '@nestjs/common';
import { InvalidCnpjException } from '@modules/companies/domain/dtos/errors/invalid-cnpj.exception.js';
import { CacheNamespace } from '@shared/domain/dtos/providers/cache-key.dto.js';
import { UseCase } from '@shared/domain/protocols/use-case.protocol.js';
import { CacheProvider } from '@shared/domain/providers/cache.provider.js';
import { parseCnpj } from '@shared/domain/value-objects/cnpj.js';
import { CompanyRemovalRepository } from '../../domain/dtos/repositories/company-removal.repository.js';
import type { CompanyRemoval } from '../../domain/dtos/requests/company-removal.dto.js';

const COMPANY_CACHES = [
  CacheNamespace.COMPANY_PROFILE,
  CacheNamespace.COMPANY_EVIDENCES,
  CacheNamespace.COMPANY_SCORES,
];

/**
 * Retira um cadastro do BIOS a pedido do titular (LGPD, art. 18). A titularidade é conferida
 * antes, no atendimento do pedido.
 *
 * Apaga o que estava guardado e deixa o CNPJ na lista, para que nenhuma coleta o traga de volta.
 * Repetir a retirada apaga de novo, sem erro. As médias de setor ficam como estão: elas não
 * identificam nenhuma empresa.
 */
@Injectable()
export class RemoveCompanyUseCase extends UseCase<string, CompanyRemoval> {
  constructor(
    private readonly removals: CompanyRemovalRepository,
    private readonly cache: CacheProvider,
  ) {
    super();
  }

  override async execute(input: string): Promise<CompanyRemoval> {
    const cnpj = parseCnpj(input);

    if (!cnpj) throw new InvalidCnpjException();

    const { removedAt } = await this.removals.remove(cnpj);

    await Promise.all([
      ...COMPANY_CACHES.map((namespace) =>
        this.cache.delete({ namespace, identifier: cnpj }),
      ),
      this.cache.delete({
        namespace: CacheNamespace.COMPANY_ANALYTICS,
        identifier: 'base',
      }),
    ]);

    return { cnpj, removed_at: removedAt.toISOString() };
  }
}

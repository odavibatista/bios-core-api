import { Injectable } from '@nestjs/common';
import { RequestTrigger } from '@prisma/client';
import { ResolveSourceCacheTtlUseCase } from '@modules/data-sources/infra/usecases/cache/resolve-source-cache-ttl.usecase.js';
import type { PostalAddress as SourceAddress } from '@modules/viacep/domain/dtos/providers/postal-address.dto.js';
import {
  VIACEP_SLUG,
  ViaCepDataSource,
} from '@modules/viacep/infra/providers/viacep.data-source.js';
import {
  type CacheKey,
  CacheNamespace,
} from '@shared/domain/dtos/providers/cache-key.dto.js';
import { UseCase } from '@shared/domain/protocols/use-case.protocol.js';
import { CacheProvider } from '@shared/domain/providers/cache.provider.js';
import {
  PostalCodeLookupUnavailableException,
  PostalCodeNotFoundException,
} from '../../domain/dtos/errors/location.errors.js';
import { LocationRepository } from '../../domain/dtos/repositories/location.repository.js';
import {
  type PostalAddress,
  PostalAddressSchema,
} from '../../domain/dtos/requests/location.dto.js';

/**
 * Endereço de um CEP (UC05, RF39).
 *
 * O município volta com o nome e o código do catálogo, para o seletor o reconhecer; código que o
 * catálogo não tem fica nulo, e a pessoa escolhe na lista. A resposta fica em cache pela janela da
 * fonte (`VIACEP`): só o CEP entra na chave, nunca um dado da conta. Fonte fora do ar não impede
 * gravar o endereço: quem chama avisa e libera o preenchimento manual.
 *
 * @throws {PostalCodeNotFoundException} quando o CEP não existe (404).
 * @throws {PostalCodeLookupUnavailableException} quando a fonte não respondeu (503).
 */
@Injectable()
export class LookupPostalCodeUseCase extends UseCase<string, PostalAddress> {
  constructor(
    private readonly viaCep: ViaCepDataSource,
    private readonly locations: LocationRepository,
    private readonly cache: CacheProvider,
    private readonly resolveCacheTtl: ResolveSourceCacheTtlUseCase,
  ) {
    super();
  }

  override async execute(postalCode: string): Promise<PostalAddress> {
    const key: CacheKey = {
      namespace: CacheNamespace.POSTAL_CODE,
      identifier: postalCode,
    };
    const cached = PostalAddressSchema.safeParse(
      await this.cache.get<unknown>(key),
    );

    if (cached.success) return cached.data;

    const result = await this.viaCep.fetch(postalCode, {
      trigger: RequestTrigger.USER_QUERY,
    });

    if (result.status === 'NOT_FOUND') throw new PostalCodeNotFoundException();

    if (result.status !== 'FOUND') {
      throw new PostalCodeLookupUnavailableException();
    }

    const address = await this.withCatalogCity(result.data);

    await this.cache.set(
      key,
      address,
      await this.resolveCacheTtl.execute(VIACEP_SLUG),
    );

    return address;
  }

  private async withCatalogCity(source: SourceAddress): Promise<PostalAddress> {
    const city =
      source.cityIbgeCode === null
        ? null
        : await this.locations.findCity(
            Number(source.cityIbgeCode),
            source.state,
          );

    return {
      postal_code: source.postalCode,
      street: source.street,
      neighborhood: source.neighborhood,
      city: city?.name ?? source.city,
      city_ibge_code: city === null ? null : String(city.ibgeCode),
      state: source.state,
    };
  }
}

/**
 * A fonte pedida não existe no catálogo.
 *
 * É erro de programação ou de configuração (um adapter com `slug` que o seed
 * não cria), e não uma situação de negócio: por isso não é uma exceção de
 * domínio com status HTTP, e sim uma falha que deve aparecer.
 */
export class UnknownDataSourceError extends Error {
  constructor(readonly slug: string) {
    super(
      `Fonte de dados "${slug}" não existe no catálogo (data_sources). ` +
        'Confira o slug do adapter e se o seeder de fontes foi executado.',
    );
    this.name = 'UnknownDataSourceError';
  }
}

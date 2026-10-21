/**
 * A fonte informada não é uma fonte de evidências do catálogo.
 *
 * É erro de configuração (o `slug` do adapter não existe, ou aponta para uma
 * fonte cadastral, ou a fonte está sem categoria/ODS), e não uma situação de
 * negócio: por isso é uma falha que deve aparecer, e não uma exceção de domínio
 * com status HTTP.
 */
export class EvidenceSourceNotFoundError extends Error {
  constructor(readonly slug: string) {
    super(
      `A fonte "${slug}" não é uma fonte de evidências do catálogo ` +
        '(data_sources com role EVIDENCE, categoria e ODS). ' +
        'Confira o slug do adapter e se o seeder de fontes foi executado.',
    );
    this.name = 'EvidenceSourceNotFoundError';
  }
}

/**
 * O registro entregue pela normalização não pode virar evidência (por exemplo,
 * sem a referência que identifica o registro no órgão de origem).
 */
export class InvalidEvidenceError extends Error {
  constructor(reason: string) {
    super(`Evidência inválida: ${reason}`);
    this.name = 'InvalidEvidenceError';
  }
}

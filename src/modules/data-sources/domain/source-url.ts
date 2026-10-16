/**
 * Monta a URL de uma chamada a partir da URL base da fonte, dos segmentos do
 * caminho e dos parâmetros de consulta.
 *
 * Cada segmento é codificado: ele é um **valor** (um CNPJ, um código), nunca um
 * trecho de caminho. Sem isso, um `../` ou um `?` num valor mal validado
 * mudaria o endereço consultado — uma requisição do BIOS para um caminho que o
 * adapter não pretendia.
 *
 * @throws {TypeError} quando a URL base não é uma URL absoluta http(s).
 */
export function buildSourceUrl(
  baseUrl: string,
  segments: readonly string[],
  query: Readonly<Record<string, string>> = {},
): string {
  const base = new URL(baseUrl);

  if (base.protocol !== 'https:' && base.protocol !== 'http:') {
    throw new TypeError(`protocolo não suportado: ${base.protocol}`);
  }

  const path = [
    base.pathname.replace(/\/+$/, ''),
    ...segments.map((segment) => encodeURIComponent(segment)),
  ].join('/');
  const search = new URLSearchParams(query).toString();

  return `${base.origin}${path}${search ? `?${search}` : ''}`;
}

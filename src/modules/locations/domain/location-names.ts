/**
 * Nome de lugar sem acento, em maiúsculas e só com letras, dígitos e espaço simples.
 *
 * Quem digita, as fontes e o IBGE escrevem o mesmo município de formas diferentes
 * (`Sant'Ana`, `SANT ANA`): comparar sempre esta forma resolve caixa, acento e pontuação.
 */
export function toSearchName(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

/**
 * Token de injeção dos provedores cadastrais registrados na cadeia.
 *
 * Quem entra aqui é o que o código conhece; **quais deles são consultados, e em
 * que ordem**, é do catálogo (`data_sources`). Um provedor novo se registra
 * neste token (no `ReceitaModule`) e ganha uma linha no catálogo.
 */
export const CADASTRAL_DATA_SOURCES = Symbol('CADASTRAL_DATA_SOURCES');

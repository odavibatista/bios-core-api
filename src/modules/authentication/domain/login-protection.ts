import { Duration } from '@shared/domain/value-objects/duration.js';

/**
 * Falhas de senha consecutivas que disparam o bloqueio (RF20, NFSE06).
 *
 * Fixas no código, e não em variável de ambiente: são requisito do produto,
 * e um valor frouxo em um ambiente esconderia a proteção justamente onde ela
 * importa.
 */
export const MAX_CONSECUTIVE_LOGIN_FAILURES = 5;

/** Duração do bloqueio por tentativas de login (RF20, NFSE06). */
export const LOGIN_BLOCK_DURATION = Duration.parse('15m');

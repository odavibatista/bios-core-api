import { SkipThrottle } from '@nestjs/throttler';
import { ThrottlerName } from '../../config/throttler.config.js';

/** Todos os limites declarados, marcados para serem ignorados. */
const ALL_THROTTLERS = Object.fromEntries(
  Object.values(ThrottlerName).map((name) => [name, true]),
);

/**
 * Isenta o endpoint (ou o controller) de **todos** os limites de requisição.
 *
 * Existe porque `@SkipThrottle()` sem argumento ignora apenas o limite
 * `default`: os limites nomeados continuam valendo, e um endpoint que se
 * pretendia isento acabaria respondendo 429 pelo limite da API pública. Este
 * decorator é derivado da lista de limites declarados, então acompanha
 * qualquer limite novo sem precisar revisitar cada endpoint isento.
 */
export const SkipRateLimit = (): MethodDecorator & ClassDecorator =>
  SkipThrottle(ALL_THROTTLERS);

import { SetMetadata } from '@nestjs/common';

/** Chave do metadado que marca uma rota como pública. */
export const IS_PUBLIC_ROUTE = 'bios:is-public-route';

/**
 * Libera o endpoint (ou o controller) da exigência de autenticação.
 *
 * **O padrão é exigir login.** O guard de autenticação é global: toda rota
 * nova nasce protegida, e quem deve ser acessível sem sessão — cadastro,
 * login, renovação, health check, endpoints isca — se declara com
 * `@Public()`. Esquecer o decorator numa rota pública a deixa inacessível, um
 * erro que aparece no primeiro teste; o inverso, esquecer de proteger uma rota
 * privada, a deixaria aberta sem que ninguém perceba.
 */
export const Public = (): MethodDecorator & ClassDecorator =>
  SetMetadata(IS_PUBLIC_ROUTE, true);

import { SetMetadata } from '@nestjs/common';

/** Chave do metadado que marca uma rota como parte da API pública. */
export const IS_PUBLIC_API_ROUTE = 'bios:is-public-api-route';

/**
 * Marca o endpoint (ou o controller) como API pública (RF17).
 *
 * É o que faz valer o limite `publicApi`, contado por chave de API: ele só
 * incide nas rotas marcadas. Sem a marca, o limite de 60 requisições por
 * janela cairia sobre todo endpoint do sistema, inclusive o login, dividido
 * entre todos que saem pelo mesmo endereço.
 *
 * A marca só diz **qual limite vale**; quem a autentica é o guard da chave de
 * API, aplicado por `@ApiKeyAuth()`, que reúne as duas coisas.
 */
export const PublicApiRoute = (): MethodDecorator & ClassDecorator =>
  SetMetadata(IS_PUBLIC_API_ROUTE, true);

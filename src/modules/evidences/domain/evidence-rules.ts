import {
  EvidenceCategory,
  EvidenceSignal,
  EvidenceState,
} from '@prisma/client';

/**
 * Por quanto tempo uma evidência `UNKNOWN` vale antes de a fonte poder ser
 * consultada de novo (15 minutos).
 *
 * `UNKNOWN` quer dizer "não conseguimos saber" (fonte fora do ar, job ainda em
 * andamento), e não "a empresa não tem registro". Uma janela curta evita
 * martelar uma fonte que acabou de falhar a cada visita ao perfil, sem manter
 * a empresa sem resposta por horas depois que a fonte voltar.
 */
export const UNKNOWN_RETRY_WINDOW_SECONDS = 15 * 60;

/**
 * Sinal que cada categoria dá ao cálculo do índice (RF10): a emissão de GEE
 * registrada é transparência (positivo); infração ambiental e sanção
 * administrativa são sinais negativos.
 *
 * O sinal deriva da categoria e não é informado por quem normaliza o registro,
 * para que a mesma categoria nunca chegue ao índice com sinais diferentes.
 */
const SIGNAL_BY_CATEGORY: Readonly<Record<EvidenceCategory, EvidenceSignal>> = {
  [EvidenceCategory.INFRACAO_AMBIENTAL]: EvidenceSignal.NEGATIVE,
  [EvidenceCategory.CONDUTA_ADMINISTRATIVA]: EvidenceSignal.NEGATIVE,
  [EvidenceCategory.EMISSAO_GEE]: EvidenceSignal.POSITIVE,
};

export function signalForCategory(category: EvidenceCategory): EvidenceSignal {
  return SIGNAL_BY_CATEGORY[category];
}

/**
 * Estado de uma evidência naquele instante (RF08).
 *
 * O banco guarda o estado da coleta (`CONFIRMED`, `NOT_FOUND` ou `UNKNOWN`);
 * `OUTDATED` é **derivado na leitura**: passada a validade, uma evidência
 * confirmada ou de "não encontrado" deixa de valer até a próxima coleta. Assim
 * não há job que precise virar o estado, e uma fonte fora do ar não deixa
 * evidência "viva" além do prazo.
 *
 * `UNKNOWN` não envelhece: não há dado a ficar velho, e ela já tem janela
 * própria de nova tentativa (`UNKNOWN_RETRY_WINDOW_SECONDS`).
 */
export function resolveEvidenceState(
  state: EvidenceState,
  validUntil: Date,
  now: Date = new Date(),
): EvidenceState {
  if (state === EvidenceState.UNKNOWN) return state;
  if (state === EvidenceState.OUTDATED) return state;

  return validUntil.getTime() <= now.getTime() ? EvidenceState.OUTDATED : state;
}

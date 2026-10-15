/**
 * Distância do fim (px) até onde a conversa ainda "acompanha" mensagens
 * novas. Acima disso a pessoa está lendo o histórico e a tela não pode
 * ser puxada para baixo.
 */
export const STICK_TO_BOTTOM_PX = 150;

export function isNearBottom(el: {
  scrollTop: number;
  clientHeight: number;
  scrollHeight: number;
}): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= STICK_TO_BOTTOM_PX;
}

/**
 * Spinner só na primeira carga de cada conversa. Recarregar a MESMA
 * conversa (reconexão do tempo real, botão de atualizar) troca as
 * mensagens em silêncio: trocar a lista por um spinner derrubava a
 * altura da área rolável e a pessoa perdia o ponto de leitura.
 */
export function shouldShowThreadSpinner(
  loadedForConversationId: string | null,
  conversationId: string,
): boolean {
  return loadedForConversationId !== conversationId;
}

import type { Message } from "@/types";

/**
 * Reconcilia uma mensagem real (vinda do realtime) com o array local de
 * mensagens, que pode conter bolhas otimistas ("temp-...") ainda não
 * confirmadas.
 *
 * Antes desta função, o código trocava TODAS as bolhas `temp-` de uma
 * vez por `newMsg` — inofensivo quando só existe uma mensagem "enviando"
 * por vez, mas quebra visivelmente ao enviar várias em sequência (um
 * lote de fotos, ou texto seguido rápido de mídia): a confirmação da
 * PRIMEIRA apagava as bolhas das OUTRAS, que só reapareciam uma a uma
 * conforme cada uma confirmasse por conta própria.
 *
 * Substitui, em vez disso, só a bolha otimista MAIS ANTIGA da MESMA
 * conversa — funciona porque os envios são sequenciais (cada um espera
 * o ciclo completo do anterior antes de começar), então tanto o insert
 * no banco quanto a entrega via realtime preservam essa mesma ordem.
 *
 * Limite conhecido: se duas ações de envio INDEPENDENTES (não um lote
 * desta função) ficarem em voo ao mesmo tempo na mesma conversa — ex.:
 * o usuário manda um texto e, antes da confirmação chegar, dispara um
 * lote de fotos — a correspondência por ordem pode trocar a bolha
 * errada. Cenário raro (exige duas ações de envio distintas
 * sobrepostas na janela de latência da rede) e estritamente melhor que
 * o comportamento anterior, que apagava todas.
 */
export function reconcileIncomingMessage(
  prev: Message[],
  newMsg: Message,
): Message[] {
  // Já está na lista com o id real (id trocado por uma atualização
  // anterior, ou evento duplicado do realtime) — nada a fazer.
  if (prev.some((m) => m.id === newMsg.id)) return prev;

  const oldestPendingIdx = prev.findIndex(
    (m) => m.id.startsWith("temp-") && m.conversation_id === newMsg.conversation_id,
  );

  if (oldestPendingIdx === -1) {
    return [...prev, newMsg];
  }

  const next = prev.slice();
  next[oldestPendingIdx] = newMsg;
  return next;
}

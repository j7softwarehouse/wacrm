import { isAwaitingReply, type AwaitingReplyRow } from "@/lib/dashboard/business-hours";

/** Linha da RPC conversations_awaiting_reply, já com o id da conversa. */
export type AwaitingReplyItem = AwaitingReplyRow & { conversation_id: string };

/**
 * A RPC devolve uma linha por conversa aberta da conta (~900 em
 * produção, 124 KB por chamada) — buscada a cada 60 s em toda Inbox e
 * Dashboard abertos, era o maior gasto de egress do Supabase (plano
 * grátis, 5 GB/mês). A busca fica espaçada; o selo "+30 min" muda com o
 * tempo passando e é recalculado localmente, sem rede. 15 min aprovado
 * pelo usuário: uma pendência nova pode levar até isso para aparecer
 * (resposta tira o selo na hora — ver buildAwaitingReplyMap).
 */
export const AWAITING_REPLY_FETCH_MS = 15 * 60_000;
export const AWAITING_REPLY_RECOMPUTE_MS = 60_000;

/** O que a lista de conversas (tempo real) sabe sobre a mensagem mais
 *  recente de uma conversa. `senderType` só existe depois que um evento
 *  de tempo real passa por ela nesta sessão — na carga inicial da
 *  página é `undefined`, e aí não dá pra confiar na exclusão abaixo. */
export interface LastMessageInfo {
  at: string | null | undefined;
  senderType?: "customer" | "agent" | "bot";
}

/**
 * Conversas "sem resposta +30 min", indexadas pelo id.
 *
 * `lastMessageById` vem da lista de conversas, que o tempo real mantém
 * atualizada entre uma busca da RPC e outra. Uma conversa só sai do mapa
 * quando a mensagem mais nova que a da RPC é do ATENDENTE ou do BOT —
 * aí sim ela foi respondida. Bug real de produção (20/10/2026): a
 * versão anterior excluía por qualquer mensagem mais nova, sem saber
 * quem mandou — um novo "oi" do CLIENTE também tirava a conversa da
 * lista, escondendo justamente quem mais precisava de resposta (e
 * fazia o filtro da Inbox mostrar menos conversas que o card do
 * Dashboard). Sem saber o remetente (carga inicial, sem evento de
 * tempo real ainda) a exclusão não acontece — confia na RPC.
 */
export function buildAwaitingReplyMap(
  rows: readonly AwaitingReplyItem[],
  lastMessageById: ReadonlyMap<string, LastMessageInfo>,
  now: Date,
): Map<string, AwaitingReplyItem> {
  const map = new Map<string, AwaitingReplyItem>();
  for (const row of rows) {
    if (!isAwaitingReply(row, now)) continue;
    const current = lastMessageById.get(row.conversation_id);
    const respondedByUs = current?.senderType === "agent" || current?.senderType === "bot";
    if (
      respondedByUs &&
      current?.at &&
      row.last_message_at &&
      Date.parse(current.at) > Date.parse(row.last_message_at)
    ) {
      continue;
    }
    map.set(row.conversation_id, row);
  }
  return map;
}

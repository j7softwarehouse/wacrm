import { isAwaitingReply, type AwaitingReplyRow } from "@/lib/dashboard/business-hours";

/** Linha da RPC conversations_awaiting_reply, já com o id da conversa. */
export type AwaitingReplyItem = AwaitingReplyRow & { conversation_id: string };

/**
 * A RPC devolve uma linha por conversa aberta da conta (~900 em
 * produção, 124 KB por chamada) — buscada a cada 60 s em toda Inbox e
 * Dashboard abertos, era o maior gasto de egress do Supabase (plano
 * grátis, 5 GB/mês). A busca fica espaçada; o selo "+30 min" muda com o
 * tempo passando e é recalculado localmente, sem rede.
 */
export const AWAITING_REPLY_FETCH_MS = 5 * 60_000;
export const AWAITING_REPLY_RECOMPUTE_MS = 60_000;

/**
 * Conversas "sem resposta +30 min", indexadas pelo id.
 *
 * `lastMessageAtById` vem da lista de conversas, que o tempo real mantém
 * atualizada entre uma busca da RPC e outra. Se ela já tem mensagem mais
 * nova que a última vista pela RPC, a conversa sai do mapa: ou o
 * atendente respondeu, ou o cliente mandou outra mensagem — e aí o
 * relógio dos 30 minutos recomeça dela (a RPC olha a ÚLTIMA mensagem),
 * então também não está pendente agora. Nos dois casos o resultado é o
 * mesmo que a RPC daria se fosse consultada de novo.
 */
export function buildAwaitingReplyMap(
  rows: readonly AwaitingReplyItem[],
  lastMessageAtById: ReadonlyMap<string, string | null | undefined>,
  now: Date,
): Map<string, AwaitingReplyItem> {
  const map = new Map<string, AwaitingReplyItem>();
  for (const row of rows) {
    if (!isAwaitingReply(row, now)) continue;
    const current = lastMessageAtById.get(row.conversation_id);
    if (
      current &&
      row.last_message_at &&
      Date.parse(current) > Date.parse(row.last_message_at)
    ) {
      continue;
    }
    map.set(row.conversation_id, row);
  }
  return map;
}

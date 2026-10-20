/** Linha de `messages` que `pickMessageIdsToMarkRead` precisa ver. */
export interface MarkReadCandidate {
  message_id?: string | null;
  sender_type: "customer" | "agent" | "bot";
  status: "sending" | "sent" | "delivered" | "read" | "failed";
}

/**
 * `message_id` (formato uazapi, sem prefixo) das mensagens do CLIENTE
 * ainda não marcadas como lidas — o que `POST .../mark-read` manda pra
 * `/message/markread`. Só o cliente gera leitura pendente: mensagem do
 * atendente/bot não é "lida" pelo CRM, é lida pelo PRÓPRIO cliente (ver
 * `message-bubble.tsx`). Mensagem sem `message_id` nunca foi
 * confirmada pelo WhatsApp — não há o que marcar.
 */
export function pickMessageIdsToMarkRead(messages: MarkReadCandidate[]): string[] {
  return messages
    .filter((m) => m.sender_type === "customer" && m.status !== "read" && m.message_id)
    .map((m) => m.message_id as string);
}

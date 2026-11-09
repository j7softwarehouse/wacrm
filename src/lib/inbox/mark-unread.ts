/**
 * Quantas não lidas mostrar quando alguém marca uma conversa como não lida.
 *
 * Conta as mensagens do cliente (sender_type 'customer') que chegaram depois
 * da última resposta da equipe (sender_type 'agent'). Mínimo de 1: marcar como
 * não lida sempre deixa a conversa com selo, mesmo quando a última mensagem
 * já é da equipe.
 *
 * Recebe as mensagens em qualquer ordem; ordena por created_at.
 */
export function unreadCountSinceLastReply(
  messages: { sender_type: string; created_at: string }[],
): number {
  const sorted = [...messages].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );
  let lastAgent = -1;
  sorted.forEach((m, i) => {
    if (m.sender_type === "agent") lastAgent = i;
  });
  const inbound = sorted.slice(lastAgent + 1).filter((m) => m.sender_type === "customer");
  return Math.max(1, inbound.length);
}

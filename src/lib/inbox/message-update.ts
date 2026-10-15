import type { Message } from "@/types";

/**
 * Aplica um UPDATE de mensagem (vindo do realtime) ao array local.
 *
 * Devolve o MESMO array quando a mensagem não está na conversa aberta
 * ou quando o evento não muda nenhum campo. A Inbox escuta UPDATE de
 * todas as mensagens da conta (tiques, leitura, edição — de qualquer
 * conversa), e um array novo a cada evento disparava o efeito de
 * rolagem da conversa aberta, puxando a tela para o fim a cada um.
 */
export function applyMessageUpdate(prev: Message[], update: Message): Message[] {
  const idx = prev.findIndex((m) => m.id === update.id);
  if (idx === -1) return prev;

  const current = prev[idx];
  const changed = (Object.keys(update) as (keyof Message)[]).some(
    (key) => update[key] !== current[key],
  );
  if (!changed) return prev;

  const next = prev.slice();
  next[idx] = { ...current, ...update };
  return next;
}

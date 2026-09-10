import type { ConversationStatus } from '@/types';

/**
 * Única fonte das cores de status de conversa (Aberto/Pendente/Fechado).
 * Antes disso, `conversation-list.tsx` e `message-thread.tsx` definiam o
 * mapa cada um por conta própria e podiam divergir.
 *
 * As classes apontam para tokens fixos (`--status-*` em globals.css), não
 * para `--primary`: "Aberto" usar a cor de destaque da conta ficava quase
 * idêntico a "Pendente" nos temas laranja/vermelho, e "Fechado" com
 * `--muted-foreground` ficava quase invisível no tema dark (muito perto
 * de `--card`). Ver globals.css para os valores oklch de cada modo.
 */
export const CONVERSATION_STATUS_DOT_CLASS: Record<ConversationStatus, string> = {
  open: 'bg-status-open',
  pending: 'bg-status-pending',
  closed: 'bg-status-closed',
};

export const CONVERSATION_STATUS_TEXT_CLASS: Record<ConversationStatus, string> = {
  open: 'text-status-open',
  pending: 'text-status-pending',
  closed: 'text-status-closed',
};

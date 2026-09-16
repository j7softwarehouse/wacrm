import type { SupabaseClient } from '@supabase/supabase-js';

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

/** Quanto tempo uma conversa fica fechada antes de voltar sozinha para
 *  "Aberto". Pedido do usuário (2026-09-15): fechar é uma decisão do
 *  momento, não um arquivamento permanente. */
export const CLOSED_REOPEN_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * Patch a ser gravado em `conversations` ao mudar o status. Existe para
 * que todo lugar que muda status (dropdown da conversa, ação
 * `close_conversation` das Automações, `handoff` dos Fluxos) mantenha
 * `closed_at` coerente — é ele, e não `updated_at`, que diz QUANDO a
 * conversa foi fechada: `updated_at` é reescrito por toda mensagem nova
 * e toda contagem de não lidas.
 *
 * Sair de "fechado" para qualquer outro status limpa o carimbo, senão a
 * varredura de 24h reabriria uma conversa que o atendente acabou de pôr
 * em "pendente" de propósito.
 */
export function conversationStatusPatch(
  status: ConversationStatus,
  now: Date = new Date(),
): { status: ConversationStatus; closed_at: string | null; updated_at: string } {
  const iso = now.toISOString();
  return {
    status,
    closed_at: status === 'closed' ? iso : null,
    updated_at: iso,
  };
}

/**
 * Campos a somar no UPDATE de uma conversa que acabou de receber
 * mensagem: se estava FECHADA, reabre na hora — o cliente voltou a
 * escrever, esperar as 24h da varredura esconderia a mensagem da fila de
 * trabalho. "Pendente" e "Aberta" ficam como estão (pendente é manual).
 */
export function reopenOnInboundPatch(
  currentStatus: ConversationStatus | null | undefined,
): { status: 'open'; closed_at: null } | Record<string, never> {
  return currentStatus === 'closed' ? { status: 'open', closed_at: null } : {};
}

/** Instante a partir do qual uma conversa fechada já passou das 24h. */
export function staleClosedCutoff(now: Date = new Date()): string {
  return new Date(now.getTime() - CLOSED_REOPEN_AFTER_MS).toISOString();
}

/**
 * Reabre as conversas da conta que estão fechadas há mais de 24h.
 *
 * Roda no cliente, ao carregar a caixa de entrada, e não numa cron: a
 * Vercel no plano Hobby só permite cron DIÁRIA, o que faria a
 * reabertura acontecer entre 24h e 48h depois do fechamento em vez de
 * 24h. Aqui é um UPDATE único, escopado à conta pela RLS
 * (`conversations_update` exige membro `agent`), e acontece no momento
 * em que a lista vai ser exibida — ou seja, sempre exato para quem está
 * olhando.
 *
 * "Pendente" NUNCA entra nesta varredura: é um estado manual.
 *
 * Devolve quantas conversas foram reabertas (0 inclusive quando a RLS
 * recusa a escrita para um papel `viewer`, caso em que nada acontece e
 * um `agent` reabre depois).
 */
export async function reopenStaleClosedConversations(
  supabase: SupabaseClient,
  now: Date = new Date(),
): Promise<number> {
  const { data, error } = await supabase
    .from('conversations')
    .update({ status: 'open', closed_at: null, updated_at: now.toISOString() })
    .eq('status', 'closed')
    .lt('closed_at', staleClosedCutoff(now))
    .select('id');

  if (error) {
    console.error('[inbox] falha ao reabrir conversas fechadas há 24h:', error.message);
    return 0;
  }
  return data?.length ?? 0;
}

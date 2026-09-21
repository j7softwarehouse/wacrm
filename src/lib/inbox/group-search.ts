import type { Conversation } from "@/types";

/** O suficiente do grupo pra listar/abrir — mesmo shape de
 *  `GET /api/whatsapp/groups`. */
export interface SearchableGroup {
  id: string;
  name: string | null;
  avatar_url?: string | null;
  enabled: boolean;
  left_at: string | null;
}

/**
 * Grupos que batem com a busca da Inbox mas AINDA não têm conversa
 * carregada — a superfície nova que deixa o agente achar/iniciar a
 * primeira conversa de um grupo sem passar por Configurações.
 *
 * Só entra em jogo quando a lista normal de conversas não achou nada
 * (ver conversation-list.tsx): um grupo que já tem conversa e bate com
 * a busca já teria aparecido por `matchesSearch`, então filtrar de novo
 * aqui é defesa em profundidade, não o caminho principal.
 *
 * Nunca devolve nada para uma busca vazia — esta seção é resultado de
 * busca, não uma segunda lista sempre visível. Grupo desabilitado ou
 * que o número já abandonou (`left_at`) nunca aparece: `/groups/[id]/open`
 * recusa os dois com 400, então oferecê-los aqui só levaria a um erro.
 */
export function findGroupsWithoutConversation(
  groups: SearchableGroup[],
  conversations: Conversation[],
  query: string,
): SearchableGroup[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const groupIdsWithConversation = new Set(
    conversations
      .map((c) => c.group_id)
      .filter((id): id is string => !!id),
  );

  return groups.filter(
    (g) =>
      g.enabled &&
      !g.left_at &&
      !groupIdsWithConversation.has(g.id) &&
      (g.name ?? "").toLowerCase().includes(q),
  );
}

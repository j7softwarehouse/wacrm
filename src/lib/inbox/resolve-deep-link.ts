import type { Conversation } from '@/types';

export type DeepLinkAction =
  | { type: 'skip' }
  | { type: 'already-active' }
  | { type: 'apply'; conversation: Conversation }
  | { type: 'not-found-yet' };

/**
 * Decide o que fazer com um `?c=<id>` pendente, dado o estado atual da
 * lista de conversas. Extraído de `InboxPageInner.handleConversationsLoaded`
 * pra poder testar a corrida sem montar a página inteira.
 *
 * `not-found-yet` é o caso que corrigiu um bug real: uma conversa recém
 * criada pelo botão "Conversar" (grupo ou contato, find-or-create sem
 * mensagem) pode perder a corrida contra o primeiro carregamento da
 * lista — o fetch de `ConversationList` pode ter começado (ou até
 * terminado) antes da linha nova existir pro `account_id` do usuário.
 * O chamador NÃO deve marcar o deep-link como consumido nesse caso,
 * senão a próxima atualização da lista (realtime, resync, poll) nunca
 * tenta de novo, e o agente fica preso na conversa que já estava ativa.
 */
export function resolveDeepLinkAction(params: {
  deepLinkConvId: string | null;
  alreadyConsumedId: string | null;
  loaded: Conversation[];
  activeConversationId: string | null;
}): DeepLinkAction {
  const { deepLinkConvId, alreadyConsumedId, loaded, activeConversationId } = params;

  if (!deepLinkConvId || alreadyConsumedId === deepLinkConvId || loaded.length === 0) {
    return { type: 'skip' };
  }

  if (activeConversationId === deepLinkConvId) {
    return { type: 'already-active' };
  }

  const match = loaded.find((c) => c.id === deepLinkConvId);
  if (match) {
    return { type: 'apply', conversation: match };
  }

  return { type: 'not-found-yet' };
}

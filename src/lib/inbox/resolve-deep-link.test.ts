import { describe, expect, it } from 'vitest';
import type { Conversation } from '@/types';
import { resolveDeepLinkAction } from './resolve-deep-link';

function makeConversation(id: string): Conversation {
  return {
    id,
    user_id: 'user-1',
    contact_id: null,
    status: 'open',
    unread_count: 0,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };
}

describe('resolveDeepLinkAction', () => {
  it('skip quando não há deep-link pendente', () => {
    const result = resolveDeepLinkAction({
      deepLinkConvId: null,
      alreadyConsumedId: null,
      loaded: [makeConversation('a')],
      activeConversationId: null,
    });
    expect(result).toEqual({ type: 'skip' });
  });

  it('skip quando o deep-link já foi consumido antes', () => {
    const result = resolveDeepLinkAction({
      deepLinkConvId: 'target',
      alreadyConsumedId: 'target',
      loaded: [makeConversation('target')],
      activeConversationId: null,
    });
    expect(result).toEqual({ type: 'skip' });
  });

  it('skip quando a lista ainda está vazia', () => {
    const result = resolveDeepLinkAction({
      deepLinkConvId: 'target',
      alreadyConsumedId: null,
      loaded: [],
      activeConversationId: null,
    });
    expect(result).toEqual({ type: 'skip' });
  });

  it('already-active quando a conversa alvo já é a ativa', () => {
    const result = resolveDeepLinkAction({
      deepLinkConvId: 'target',
      alreadyConsumedId: null,
      loaded: [makeConversation('target')],
      activeConversationId: 'target',
    });
    expect(result).toEqual({ type: 'already-active' });
  });

  it('apply quando a conversa alvo está na lista carregada', () => {
    const target = makeConversation('target');
    const result = resolveDeepLinkAction({
      deepLinkConvId: 'target',
      alreadyConsumedId: null,
      loaded: [makeConversation('other'), target],
      activeConversationId: 'other',
    });
    expect(result).toEqual({ type: 'apply', conversation: target });
  });

  // Corrige o bug real: "Conversar" (grupo ou contato) cria a conversa
  // via find-or-create e navega pra /inbox?c=<id> na hora, mas o
  // primeiro carregamento da lista pode ter começado (ou terminado)
  // antes dessa linha nova existir pro fetch do ConversationList. Sem
  // este caso, o chamador marcava o deep-link como consumido mesmo sem
  // aplicar nada, e a próxima atualização da lista (que já teria a
  // conversa certa) nunca tentava de novo — o agente ficava preso na
  // conversa que já estava ativa antes do clique.
  it('not-found-yet quando a conversa alvo ainda não está na lista carregada', () => {
    const result = resolveDeepLinkAction({
      deepLinkConvId: 'target-recem-criada',
      alreadyConsumedId: null,
      loaded: [makeConversation('outra-conversa-qualquer')],
      activeConversationId: 'outra-conversa-qualquer',
    });
    expect(result).toEqual({ type: 'not-found-yet' });
  });
});

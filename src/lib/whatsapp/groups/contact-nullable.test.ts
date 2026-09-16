import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { sendMessageToConversation, SendMessageError } from '@/lib/whatsapp/send-message';

describe('sendMessageToConversation diante de embed de grupo ausente', () => {
  it('recusa com erro claro quando a query nao traz o grupo, em vez de estourar em contact.phone', async () => {
    // Fase 2 envia em grupo, resolvendo o destino por `group.group_jid`.
    // Se o embed de `group` vier ausente (grupo apagado, join falhou) numa
    // conversa que tem `group_id`, o envio precisa recusar com erro claro
    // em vez de cair no ramo 1:1 e estourar em `contact.phone` de um
    // contato que nem existe (a conversa nunca tem os dois: `contact_id`
    // XOR `group_id`, garantido por `conversations_contact_xor_group`).
    const db = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              single: async () => ({
                data: {
                  id: 'cv-1',
                  account_id: 'acct-1',
                  contact_id: null,
                  group_id: 'grp-1',
                  contact: null,
                },
                error: null,
              }),
            }),
          }),
        }),
      }),
    } as unknown as SupabaseClient;

    await expect(
      sendMessageToConversation(db, 'acct-1', {
        conversationId: 'cv-1',
        messageType: 'text',
        contentText: 'oi',
      }),
    ).rejects.toBeInstanceOf(SendMessageError);
  });
});

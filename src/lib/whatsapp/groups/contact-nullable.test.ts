import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { sendMessageToConversation, SendMessageError } from '@/lib/whatsapp/send-message';

describe('caminhos 1:1 diante de conversa de grupo', () => {
  it('sendMessageToConversation recusa conversa sem contato', async () => {
    // Fase 1 nao envia em grupo. O envio precisa recusar com erro
    // claro em vez de estourar em `contact.phone` de undefined.
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

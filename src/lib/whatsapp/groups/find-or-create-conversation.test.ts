import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { findOrCreateConversationForGroup } from './find-or-create-conversation';

describe('findOrCreateConversationForGroup', () => {
  it('reaproveita a conversa existente em vez de criar outra', async () => {
    const db = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { id: 'conv-existing' },
                  error: null,
                }),
              }),
            }),
          }),
        }),
      }),
    } as unknown as SupabaseClient;

    const id = await findOrCreateConversationForGroup(db, 'acct-1', 'user-1', 'grp-1', 'ch-1');

    expect(id).toBe('conv-existing');
  });

  it('cria a conversa quando nao existe', async () => {
    const inserted: Record<string, unknown>[] = [];
    const db = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: null, error: null }),
              }),
            }),
          }),
        }),
        insert: (row: Record<string, unknown>) => {
          inserted.push(row);
          return {
            select: () => ({
              single: async () => ({ data: { id: 'conv-new' }, error: null }),
            }),
          };
        },
      }),
    } as unknown as SupabaseClient;

    const id = await findOrCreateConversationForGroup(db, 'acct-1', 'user-1', 'grp-1', 'ch-1');

    expect(id).toBe('conv-new');
    expect(inserted[0]).toMatchObject({
      account_id: 'acct-1',
      group_id: 'grp-1',
      channel_id: 'ch-1',
      contact_id: null,
    });
  });

  it('perde uma corrida contra outro criador (ex.: webhook) e reaproveita a linha vencedora em vez de falhar', async () => {
    // O botão "Conversar" e a entrega de uma mensagem recebida via webhook
    // (resolveGroupConversation) podem correr ao mesmo tempo para o MESMO
    // grupo: os dois fazem SELECT "não existe" antes de qualquer um dos
    // dois terminar o INSERT. idx_conversations_account_group_channel
    // rejeita o segundo insert com 23505 — sem este tratamento, o segundo
    // caminho devolveria null (500 genérico para quem clicou "Conversar").
    let selectCalls = 0;
    const db = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => {
                  selectCalls += 1;
                  // 1ª chamada: "não existe ainda" (decide tentar o insert).
                  // 2ª chamada (após perder a corrida): a linha vencedora.
                  return selectCalls === 1
                    ? { data: null, error: null }
                    : { data: { id: 'conv-winner' }, error: null };
                },
              }),
            }),
          }),
        }),
        insert: () => ({
          select: () => ({
            single: async () => ({
              data: null,
              error: {
                code: '23505',
                message:
                  'duplicate key value violates unique constraint "idx_conversations_account_group_channel"',
              },
            }),
          }),
        }),
      }),
    } as unknown as SupabaseClient;

    const id = await findOrCreateConversationForGroup(db, 'acct-1', 'user-1', 'grp-1', 'ch-1');

    expect(id).toBe('conv-winner');
  });
});

import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { resolveGroupConversation } from './resolve-group-conversation';

const GROUP = {
  groupJid: '120363000000000000@g.us',
  participantJid: '5511999999999@s.whatsapp.net',
  participantName: 'Fulano',
};

function fakeDb(opts: {
  group: { id: string; enabled: boolean } | null;
  inserted: Record<string, unknown[]>;
}) {
  const inserted = opts.inserted;
  return {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: table === 'whatsapp_groups' ? opts.group : null,
                error: null,
              }),
            }),
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        }),
      }),
      insert: (row: Record<string, unknown>) => {
        (inserted[table] ??= []).push(row);
        return {
          select: () => ({
            single: async () => ({ data: { id: `${table}-1`, ...row }, error: null }),
          }),
        };
      },
      update: () => ({ eq: async () => ({ error: null }) }),
    }),
  } as unknown as SupabaseClient;
}

describe('resolveGroupConversation', () => {
  it('registra o grupo desconhecido como desabilitado e NAO cria conversa', async () => {
    // Assim a tela de selecao descobre os grupos existentes sem que
    // eles apareçam na inbox antes de alguem autorizar.
    const inserted: Record<string, unknown[]> = {};
    const db = fakeDb({ group: null, inserted });

    const r = await resolveGroupConversation(db, 'acct-1', 'ch-1', 'user-1', GROUP);

    expect(r).toBeNull();
    expect(inserted['whatsapp_groups']?.[0]).toMatchObject({
      group_jid: GROUP.groupJid,
      enabled: false,
    });
    expect(inserted['conversations']).toBeUndefined();
  });

  it('descarta mensagem de grupo conhecido porem desabilitado', async () => {
    const inserted: Record<string, unknown[]> = {};
    const db = fakeDb({ group: { id: 'grp-1', enabled: false }, inserted });

    const r = await resolveGroupConversation(db, 'acct-1', 'ch-1', 'user-1', GROUP);

    expect(r).toBeNull();
    expect(inserted['conversations']).toBeUndefined();
  });

  it('cria conversa e participante quando o grupo esta habilitado', async () => {
    const inserted: Record<string, unknown[]> = {};
    const db = fakeDb({ group: { id: 'grp-1', enabled: true }, inserted });

    const r = await resolveGroupConversation(db, 'acct-1', 'ch-1', 'user-1', GROUP);

    expect(r).not.toBeNull();
    expect(r!.groupId).toBe('grp-1');
    // Conversa de grupo tem contact_id nulo — o CHECK do banco exige
    // exatamente um entre contact_id e group_id.
    expect(inserted['conversations']?.[0]).toMatchObject({
      group_id: 'grp-1',
      contact_id: null,
    });
    expect(inserted['group_participants']?.[0]).toMatchObject({
      participant_jid: GROUP.participantJid,
      phone: '5511999999999',
    });
  });

  it('grava phone nulo quando o participante e @lid', async () => {
    // O WhatsApp entrega participantes como @lid (identificador opaco,
    // sem telefone) cada vez mais. Gravar o LID como telefone criaria
    // contato/numero falso.
    const inserted: Record<string, unknown[]> = {};
    const db = fakeDb({ group: { id: 'grp-1', enabled: true }, inserted });

    await resolveGroupConversation(db, 'acct-1', 'ch-1', 'user-1', {
      ...GROUP,
      participantJid: '98765432100000@lid',
    });

    expect(inserted['group_participants']?.[0]).toMatchObject({ phone: null });
  });
});

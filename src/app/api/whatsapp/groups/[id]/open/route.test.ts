import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Tests for the Settings → Grupos "Conversar" button's backing route:
// find-or-create the group's conversation WITHOUT sending anything, so the
// UI can jump straight to /inbox?c=<id> — mirrors
// conversations/open/route.test.ts (o mesmo botão para Contatos).
// ---------------------------------------------------------------------------

const conversationInserts: Array<Record<string, unknown>> = [];

let existingConversation: Record<string, unknown> | null = null;
let groupRow: Record<string, unknown> | null = null;
let createdConversation: Record<string, unknown> | null = null;

const GROUP = {
  id: 'group-1',
  account_id: 'acct-1',
  channel_id: 'chan-1',
  enabled: true,
  left_at: null,
};

function makeSupabaseMock() {
  function builder(table: string) {
    let didInsert = false;

    const selectResult = () => {
      switch (table) {
        case 'profiles':
          return { data: { account_id: 'acct-1' }, error: null };
        case 'whatsapp_groups':
          return { data: groupRow, error: null };
        case 'conversations':
          return { data: createdConversation ?? existingConversation, error: null };
        default:
          return { data: null, error: null };
      }
    };

    const insertResult = () => {
      switch (table) {
        case 'conversations':
          return { data: createdConversation ?? existingConversation, error: null };
        default:
          return { data: null, error: null };
      }
    };

    const terminal = () => Promise.resolve(didInsert ? insertResult() : selectResult());

    const b: Record<string, unknown> = {};
    const chain = () => b;
    for (const m of ['select', 'eq', 'is']) {
      b[m] = vi.fn(chain);
    }
    b.insert = vi.fn((payload: Record<string, unknown>) => {
      didInsert = true;
      if (table === 'conversations') {
        conversationInserts.push(payload);
        createdConversation = {
          id: 'conv-new',
          account_id: 'acct-1',
          group_id: 'group-1',
        };
      }
      return b;
    });
    b.single = vi.fn(terminal);
    b.maybeSingle = vi.fn(terminal);
    return b;
  }

  return {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: 'user-1' } },
        error: null,
      })),
    },
    from: vi.fn((table: string) => builder(table)),
  };
}

let supabaseMock = makeSupabaseMock();

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => supabaseMock),
}));

import { POST } from './route';

function postOpen(id = 'group-1') {
  return POST(new Request(`http://localhost/api/whatsapp/groups/${id}/open`, { method: 'POST' }), {
    params: Promise.resolve({ id }),
  });
}

describe('POST /api/whatsapp/groups/[id]/open', () => {
  beforeEach(() => {
    conversationInserts.length = 0;
    existingConversation = null;
    createdConversation = null;
    groupRow = { ...GROUP };
    supabaseMock = makeSupabaseMock();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('cria a conversa do grupo quando nao existe, sem mandar nada', async () => {
    const res = await postOpen();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.conversation_id).toBe('conv-new');
    expect(conversationInserts).toHaveLength(1);
    expect(conversationInserts[0]).toMatchObject({
      account_id: 'acct-1',
      group_id: 'group-1',
      channel_id: 'chan-1',
      contact_id: null,
    });
  });

  it('reaproveita a conversa existente em vez de duplicar', async () => {
    existingConversation = {
      id: 'conv-existing',
      account_id: 'acct-1',
      group_id: 'group-1',
    };

    const res = await postOpen();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.conversation_id).toBe('conv-existing');
    expect(conversationInserts).toHaveLength(0);
  });

  it('404 quando o grupo nao pertence a conta', async () => {
    groupRow = null;

    const res = await postOpen();
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.error).toMatch(/group not found/i);
  });

  it('400 quando o grupo esta desabilitado (nao esta na caixa de entrada)', async () => {
    groupRow = { ...GROUP, enabled: false };

    const res = await postOpen();
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/not available/i);
    expect(conversationInserts).toHaveLength(0);
  });

  it('400 quando o numero ja saiu do grupo (left_at preenchido)', async () => {
    groupRow = { ...GROUP, left_at: '2026-09-05T00:00:00Z' };

    const res = await postOpen();
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/not available/i);
    expect(conversationInserts).toHaveLength(0);
  });
});

import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getProviderForChannel: vi.fn(),
  resolveDefaultChannelId: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));
vi.mock('@/lib/whatsapp/providers/resolve', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/whatsapp/providers/resolve')>();
  return {
    ...actual,
    getProviderForChannel: mocks.getProviderForChannel,
    resolveDefaultChannelId: mocks.resolveDefaultChannelId,
  };
});

import { POST } from './route';

/**
 * Cliente com sessão de `acct-1`. `upsertedRows` captura o payload do
 * upsert em `whatsapp_groups` para a asserção central deste arquivo:
 * o `enabled` de um grupo já cadastrado não pode ser sobrescrito.
 *
 * O builder real do supabase-js é "thenable" — `await query` resolve
 * para `{ data, error }` sem precisar chamar `.then()` explicitamente —
 * então `.select()` aqui devolve uma Promise diretamente.
 */
function comSessao(role: string, upsertedRows: Array<Record<string, unknown>>[]) {
  return {
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }) },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { account_id: 'acct-1', account_role: role },
            error: null,
          }),
        }),
      }),
      upsert: (rows: Array<Record<string, unknown>>) => {
        upsertedRows.push(rows);
        const result = { data: rows.map((_, i) => ({ id: `g-${i}` })), error: null };
        return {
          select: () => Promise.resolve(result),
        };
      },
    }),
  };
}

describe('POST /api/whatsapp/groups/sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveDefaultChannelId.mockResolvedValue('chan-1');
    mocks.getProviderForChannel.mockResolvedValue({
      listGroups: async () => [
        { groupJid: '1@g.us', name: 'Turma A' },
        { groupJid: '2@g.us', name: 'Turma B' },
      ],
    });
  });

  function request() {
    return new Request('https://x/api/whatsapp/groups/sync', { method: 'POST' });
  }

  it('devolve 401 sem sessao', async () => {
    mocks.createClient.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    });

    const res = await POST(request());

    expect(res.status).toBe(401);
  });

  it('devolve 403 quando o chamador nao e admin', async () => {
    const rows: Array<Record<string, unknown>>[] = [];
    mocks.createClient.mockResolvedValue(comSessao('viewer', rows));

    const res = await POST(request());

    expect(res.status).toBe(403);
    expect(rows).toHaveLength(0);
  });

  it('sincroniza os grupos do provider e devolve a contagem', async () => {
    const rows: Array<Record<string, unknown>>[] = [];
    mocks.createClient.mockResolvedValue(comSessao('admin', rows));

    const res = await POST(request());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.synced).toBe(2);
    expect(mocks.getProviderForChannel).toHaveBeenCalledWith(expect.anything(), 'chan-1');
  });

  it('nao inclui `enabled` no upsert — preserva o valor ja ligado pelo usuario', async () => {
    const rows: Array<Record<string, unknown>>[] = [];
    mocks.createClient.mockResolvedValue(comSessao('admin', rows));

    await POST(request());

    expect(rows).toHaveLength(1);
    for (const row of rows[0]) {
      expect(row).not.toHaveProperty('enabled');
      expect(row.account_id).toBe('acct-1');
      expect(row.channel_id).toBe('chan-1');
    }
  });
});

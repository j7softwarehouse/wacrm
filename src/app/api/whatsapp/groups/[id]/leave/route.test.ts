import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getProviderForChannel: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));
vi.mock('@/lib/whatsapp/providers/resolve', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/whatsapp/providers/resolve')>();
  return { ...actual, getProviderForChannel: mocks.getProviderForChannel };
});

import { POST } from './route';

function comSessao(role: string, grupo: Record<string, unknown> | null) {
  return {
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }) },
    from: (table: string) => {
      if (table === 'profiles') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { account_id: 'acct-1', account_role: role },
                error: null,
              }),
            }),
          }),
        };
      }
      // whatsapp_groups
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: grupo, error: null }),
        update: () => ({ eq: async () => ({ error: null }) }),
      };
      return chain;
    },
  };
}

function request() {
  return new Request('https://x/api/whatsapp/groups/g-1/leave', { method: 'POST' });
}
const params = Promise.resolve({ id: 'g-1' });

describe('POST /api/whatsapp/groups/[id]/leave', () => {
  beforeEach(() => vi.clearAllMocks());

  it('devolve 401 sem sessao', async () => {
    mocks.createClient.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    });
    const res = await POST(request(), { params });
    expect(res.status).toBe(401);
  });

  it('devolve 403 quando o chamador nao e admin', async () => {
    mocks.createClient.mockResolvedValue(
      comSessao('agent', { id: 'g-1', account_id: 'acct-1', channel_id: 'chan-1', group_jid: '1@g.us' }),
    );
    const res = await POST(request(), { params });
    expect(res.status).toBe(403);
  });

  it('devolve 404 quando o grupo nao pertence a conta', async () => {
    mocks.createClient.mockResolvedValue(comSessao('admin', null));
    const res = await POST(request(), { params });
    expect(res.status).toBe(404);
  });

  it('sai do grupo e confirma via listGroups antes de marcar left_at', async () => {
    mocks.createClient.mockResolvedValue(
      comSessao('admin', { id: 'g-1', account_id: 'acct-1', channel_id: 'chan-1', group_jid: '1@g.us' }),
    );
    const leaveGroup = vi.fn(async () => {});
    const listGroups = vi.fn(async () => []); // grupo sumiu -- confirma saida
    mocks.getProviderForChannel.mockResolvedValue({ leaveGroup, listGroups });

    const res = await POST(request(), { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.left).toBe(true);
    expect(leaveGroup).toHaveBeenCalledWith('1@g.us');
    expect(listGroups).toHaveBeenCalled();
  });

  it('devolve erro claro quando a uazapi diz sucesso mas o grupo continua na lista', async () => {
    // Achado empirico (spec Fase 3): /group/leave sempre "successful",
    // mesmo sem efeito. A rota nao pode confiar nisso.
    mocks.createClient.mockResolvedValue(
      comSessao('admin', { id: 'g-1', account_id: 'acct-1', channel_id: 'chan-1', group_jid: '1@g.us' }),
    );
    const leaveGroup = vi.fn(async () => {});
    const listGroups = vi.fn(async () => [{ groupJid: '1@g.us', name: 'Teste' }]); // ainda la
    mocks.getProviderForChannel.mockResolvedValue({ leaveGroup, listGroups });

    const res = await POST(request(), { params });

    expect(res.status).toBe(502);
  });
});

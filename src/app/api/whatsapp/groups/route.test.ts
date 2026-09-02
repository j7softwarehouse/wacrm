import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));

import { GET, PATCH } from './route';

/**
 * Cliente com sessão e perfil ligado a `acct-1`, papel `admin` por
 * padrão. Escrita em `whatsapp_groups` exige admin na RLS (Tarefa 1,
 * policy "admins write groups") — a rota replica essa checagem do
 * lado da aplicação para devolver 403 com mensagem clara em vez de
 * deixar o RLS negar silenciosamente (update afeta 0 linhas).
 */
function comSessao(
  grupos: Array<Record<string, unknown>>,
  role: string = 'admin',
) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    order: async () => ({ data: grupos, error: null }),
    maybeSingle: async () => ({
      data: { account_id: 'acct-1', account_role: role },
      error: null,
    }),
    single: async () => ({ data: grupos[0] ?? null, error: null }),
  };
  return {
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }) },
    from: () => ({ ...chain, update: () => chain }),
  };
}

/**
 * Variante com uma fila de respostas para `.maybeSingle()` — permite
 * diferenciar a primeira chamada (perfil) da segunda (resultado do
 * update), já que o fake genérico acima não distingue por tabela.
 */
function comSessaoQueue(maybeSingleQueue: Array<{ data: unknown; error: unknown }>) {
  let call = 0;
  const chain = {
    select: () => chain,
    eq: () => chain,
    order: async () => ({ data: [], error: null }),
    maybeSingle: async () =>
      maybeSingleQueue[Math.min(call++, maybeSingleQueue.length - 1)],
    single: async () => ({ data: null, error: null }),
  };
  return {
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }) },
    from: () => ({ ...chain, update: () => chain }),
  };
}

describe('GET /api/whatsapp/groups', () => {
  beforeEach(() => vi.clearAllMocks());

  it('devolve 401 sem sessao', async () => {
    mocks.createClient.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    });

    const res = await GET(new Request('https://x/api/whatsapp/groups'));

    expect(res.status).toBe(401);
  });

  it('lista os grupos da conta do chamador', async () => {
    mocks.createClient.mockResolvedValue(
      comSessao([{ id: 'g-1', group_jid: '1@g.us', name: 'Turma', enabled: false }]),
    );

    const res = await GET(new Request('https://x/api/whatsapp/groups'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.groups).toHaveLength(1);
    expect(body.groups[0].id).toBe('g-1');
  });

  it('devolve 403 quando o perfil nao esta ligado a uma conta', async () => {
    mocks.createClient.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }) },
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
      }),
    });

    const res = await GET(new Request('https://x/api/whatsapp/groups'));

    expect(res.status).toBe(403);
  });
});

describe('PATCH /api/whatsapp/groups', () => {
  beforeEach(() => vi.clearAllMocks());

  it('alterna o enabled do grupo quando o chamador e admin', async () => {
    mocks.createClient.mockResolvedValue(
      comSessao([{ id: 'g-1', enabled: true }]),
    );

    const res = await PATCH(
      new Request('https://x/api/whatsapp/groups', {
        method: 'PATCH',
        body: JSON.stringify({ id: 'g-1', enabled: true }),
      }),
    );

    expect(res.status).toBe(200);
  });

  it('devolve 400 sem id', async () => {
    mocks.createClient.mockResolvedValue(comSessao([]));

    const res = await PATCH(
      new Request('https://x/api/whatsapp/groups', {
        method: 'PATCH',
        body: JSON.stringify({ enabled: true }),
      }),
    );

    expect(res.status).toBe(400);
  });

  it('devolve 403 quando o chamador nao e admin — RLS nega silenciosamente, a rota nao pode deixar passar', async () => {
    mocks.createClient.mockResolvedValue(comSessao([{ id: 'g-1', enabled: true }], 'agent'));

    const res = await PATCH(
      new Request('https://x/api/whatsapp/groups', {
        method: 'PATCH',
        body: JSON.stringify({ id: 'g-1', enabled: true }),
      }),
    );

    expect(res.status).toBe(403);
  });

  it('devolve 404 para um grupo que nao pertence a conta do chamador', async () => {
    mocks.createClient.mockResolvedValue(
      comSessaoQueue([
        { data: { account_id: 'acct-1', account_role: 'admin' }, error: null },
        { data: null, error: null },
      ]),
    );

    const res = await PATCH(
      new Request('https://x/api/whatsapp/groups', {
        method: 'PATCH',
        body: JSON.stringify({ id: 'g-de-outra-conta', enabled: true }),
      }),
    );

    expect(res.status).toBe(404);
  });
});

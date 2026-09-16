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

import { GET, PATCH, POST } from './route';

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

  it('inclui left_at na resposta', async () => {
    const selectSpy = vi.fn();

    mocks.createClient.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }) },
      from: () => ({
        select: (cols: string) => {
          selectSpy(cols);
          return {
            eq: () => ({
              order: async () => ({
                data: [{ id: 'g-1', group_jid: '1@g.us', name: 'Turma', enabled: false, left_at: '2026-09-05T00:00:00Z' }],
                error: null,
              }),
              maybeSingle: async () => ({
                data: { account_id: 'acct-1', account_role: 'admin' },
                error: null,
              }),
            }),
            maybeSingle: async () => ({
              data: { account_id: 'acct-1', account_role: 'admin' },
              error: null,
            }),
          };
        },
      }),
    });

    const res = await GET(new Request('https://x/api/whatsapp/groups'));
    const body = await res.json();

    expect(body.groups[0].left_at).toBe('2026-09-05T00:00:00Z');
    // Prova que a query REAL pede left_at, não só que o JSON de saída não filtra campos.
    expect(selectSpy).toHaveBeenCalledWith(expect.stringContaining('left_at'));
  });

  it('recusa agent com 403 (role check)', async () => {
    mocks.createClient.mockResolvedValue(
      comSessao([{ id: 'g-1', group_jid: '1@g.us', name: 'Turma', enabled: false }], 'agent'),
    );

    const res = await GET(new Request('https://x/api/whatsapp/groups'));
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.error).toMatch(/admin/i);
  });

  it('recusa viewer com 403 (role check)', async () => {
    mocks.createClient.mockResolvedValue(
      comSessao([{ id: 'g-1', group_jid: '1@g.us', name: 'Turma', enabled: false }], 'viewer'),
    );

    const res = await GET(new Request('https://x/api/whatsapp/groups'));

    expect(res.status).toBe(403);
  });

  it('deixa admin passar e devolver a lista (role check)', async () => {
    mocks.createClient.mockResolvedValue(
      comSessao([{ id: 'g-1', group_jid: '1@g.us', name: 'Turma', enabled: false }], 'admin'),
    );

    const res = await GET(new Request('https://x/api/whatsapp/groups'));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.groups).toEqual([{ id: 'g-1', group_jid: '1@g.us', name: 'Turma', enabled: false }]);
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

  it('ao habilitar, limpa `left_at` no payload do update — evita o estado contraditorio enabled:true + left_at preenchido', async () => {
    const updateSpy = vi.fn();
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      order: async () => ({ data: [], error: null }),
      maybeSingle: async () => ({
        data: { account_id: 'acct-1', account_role: 'admin' },
        error: null,
      }),
    };
    // `update` precisa devolver a própria chain (para permitir
    // `.eq().eq().select().maybeSingle()` encadeado), mas o spy grava
    // o payload recebido para a asserção central deste teste.
    chain.update = (payload: Record<string, unknown>) => {
      updateSpy(payload);
      return chain;
    };
    mocks.createClient.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }) },
      from: () => chain,
    });

    const res = await PATCH(
      new Request('https://x/api/whatsapp/groups', {
        method: 'PATCH',
        body: JSON.stringify({ id: 'g-1', enabled: true }),
      }),
    );

    expect(res.status).toBe(200);
    expect(updateSpy).toHaveBeenCalledWith({ enabled: true, left_at: null });
  });

  it('ao desabilitar, mantem o comportamento antigo — nao inclui `left_at` no payload do update', async () => {
    const updateSpy = vi.fn();
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      order: async () => ({ data: [], error: null }),
      maybeSingle: async () => ({
        data: { account_id: 'acct-1', account_role: 'admin' },
        error: null,
      }),
    };
    chain.update = (payload: Record<string, unknown>) => {
      updateSpy(payload);
      return chain;
    };
    mocks.createClient.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }) },
      from: () => chain,
    });

    const res = await PATCH(
      new Request('https://x/api/whatsapp/groups', {
        method: 'PATCH',
        body: JSON.stringify({ id: 'g-1', enabled: false }),
      }),
    );

    expect(res.status).toBe(200);
    expect(updateSpy).toHaveBeenCalledWith({ enabled: false });
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

describe('POST /api/whatsapp/groups', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveDefaultChannelId.mockResolvedValue('chan-1');
    mocks.getProviderForChannel.mockResolvedValue({
      createGroup: async () => ({
        groupJid: 'novo@g.us',
        name: 'Turma 2026',
        invitedPhones: [],
      }),
    });
  });

  /**
   * `contacts` é resolvido por `.select().in().eq()` — a última chamada
   * do encadeamento já devolve a Promise (o builder real do
   * supabase-js é "thenable"). `insertSpy`, quando passado, captura o
   * payload REAL enviado a `.insert()` em `whatsapp_groups`.
   */
  function comSessaoCreate(options: {
    role?: string;
    contacts?: Array<{ id: string; phone: string | null }>;
    insertResult?: { data: unknown; error: unknown };
    insertSpy?: (payload: Record<string, unknown>) => void;
  } = {}) {
    const {
      role = 'admin',
      contacts = [{ id: 'c-1', phone: '5511999999999' }],
      insertResult = {
        data: {
          id: 'g-new',
          group_jid: 'novo@g.us',
          name: 'Turma 2026',
          avatar_url: null,
          enabled: true,
        },
        error: null,
      },
      insertSpy,
    } = options;

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
        if (table === 'contacts') {
          return {
            select: () => ({
              in: () => ({
                eq: async () => ({ data: contacts, error: null }),
              }),
            }),
          };
        }
        // whatsapp_groups
        return {
          insert: (payload: Record<string, unknown>) => {
            insertSpy?.(payload);
            return {
              select: () => ({
                single: async () => insertResult,
              }),
            };
          },
        };
      },
    };
  }

  function request(body: Record<string, unknown>) {
    return new Request('https://x/api/whatsapp/groups', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  it('devolve 401 sem sessao', async () => {
    mocks.createClient.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    });

    const res = await POST(request({ name: 'Turma', contactIds: ['c-1'] }));

    expect(res.status).toBe(401);
  });

  it('devolve 403 quando o chamador nao e admin', async () => {
    mocks.createClient.mockResolvedValue(comSessaoCreate({ role: 'agent' }));

    const res = await POST(request({ name: 'Turma', contactIds: ['c-1'] }));

    expect(res.status).toBe(403);
  });

  it('devolve 400 sem nome', async () => {
    mocks.createClient.mockResolvedValue(comSessaoCreate());

    const res = await POST(request({ contactIds: ['c-1'] }));

    expect(res.status).toBe(400);
  });

  it('devolve 400 com nome maior que 100 caracteres', async () => {
    mocks.createClient.mockResolvedValue(comSessaoCreate());

    const res = await POST(request({ name: 'x'.repeat(101), contactIds: ['c-1'] }));

    expect(res.status).toBe(400);
  });

  it('devolve 400 sem nenhum contato', async () => {
    mocks.createClient.mockResolvedValue(comSessaoCreate());

    const res = await POST(request({ name: 'Turma', contactIds: [] }));

    expect(res.status).toBe(400);
  });

  it('devolve 400 acima do limite de 50 contatos', async () => {
    mocks.createClient.mockResolvedValue(comSessaoCreate());

    const res = await POST(
      request({
        name: 'Turma',
        contactIds: Array.from({ length: 51 }, (_, i) => `c-${i}`),
      }),
    );

    expect(res.status).toBe(400);
  });

  it('devolve 400 quando um contato nao pertence a conta do chamador', async () => {
    // A rota pediu 2 ids; o `.eq("account_id", ...)` devolveu só 1 —
    // o outro id não existe ou é de outra conta.
    mocks.createClient.mockResolvedValue(
      comSessaoCreate({ contacts: [{ id: 'c-1', phone: '5511999999999' }] }),
    );

    const res = await POST(request({ name: 'Turma', contactIds: ['c-1', 'c-de-outra-conta'] }));

    expect(res.status).toBe(400);
  });

  it('devolve 400 quando um contato selecionado nao tem telefone', async () => {
    mocks.createClient.mockResolvedValue(
      comSessaoCreate({ contacts: [{ id: 'c-1', phone: null }] }),
    );

    const res = await POST(request({ name: 'Turma', contactIds: ['c-1'] }));

    expect(res.status).toBe(400);
  });

  it('devolve 400 quando a conta nao tem canal de WhatsApp configurado', async () => {
    mocks.createClient.mockResolvedValue(comSessaoCreate());
    mocks.resolveDefaultChannelId.mockResolvedValue(null);

    const res = await POST(request({ name: 'Turma', contactIds: ['c-1'] }));

    expect(res.status).toBe(400);
  });

  it('devolve 400 quando o canal padrao nao suporta criar grupo (Meta)', async () => {
    mocks.createClient.mockResolvedValue(comSessaoCreate());
    const { ProviderUnsupportedError } = await import('@/lib/whatsapp/providers/types');
    mocks.getProviderForChannel.mockResolvedValue({
      createGroup: async () => {
        throw new ProviderUnsupportedError('meta', 'createGroup');
      },
    });

    const res = await POST(request({ name: 'Turma', contactIds: ['c-1'] }));

    expect(res.status).toBe(400);
  });

  it('devolve 502 quando a UAZAPI recusa a criacao', async () => {
    mocks.createClient.mockResolvedValue(comSessaoCreate());
    const { ProviderError } = await import('@/lib/whatsapp/providers/types');
    mocks.getProviderForChannel.mockResolvedValue({
      createGroup: async () => {
        throw new ProviderError('uazapi', 'Could not parse phone');
      },
    });

    const res = await POST(request({ name: 'Turma', contactIds: ['c-1'] }));

    expect(res.status).toBe(502);
  });

  it('cria o grupo, grava enabled:true e devolve o grupo com invitedPhones', async () => {
    const insertSpy = vi.fn();
    mocks.createClient.mockResolvedValue(comSessaoCreate({ insertSpy }));
    mocks.getProviderForChannel.mockResolvedValue({
      createGroup: async (args: { name: string; participantPhones: string[] }) => {
        expect(args).toEqual({ name: 'Turma 2026', participantPhones: ['5511999999999'] });
        return { groupJid: 'novo@g.us', name: 'Turma 2026', invitedPhones: ['5521888888888'] };
      },
    });

    const res = await POST(request({ name: 'Turma 2026', contactIds: ['c-1'] }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.group).toEqual({
      id: 'g-new',
      group_jid: 'novo@g.us',
      name: 'Turma 2026',
      avatar_url: null,
      enabled: true,
    });
    expect(body.invitedPhones).toEqual(['5521888888888']);
    expect(insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        account_id: 'acct-1',
        channel_id: 'chan-1',
        group_jid: 'novo@g.us',
        name: 'Turma 2026',
        enabled: true,
      }),
    );
  });
});
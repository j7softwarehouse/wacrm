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

import { GET, POST } from './route';

// O filtro de `whatsapp_groups` respeita de fato os `.eq(coluna, valor)`
// encadeados (comparando contra o `grupo` fornecido), simulando o AND
// que o PostgREST aplica na query real -- assim um teste que passa um
// `grupo` de OUTRA conta só "acha" o grupo se a rota não filtrar por
// `account_id`, expondo a falta de isolamento por conta. Mesmo padrão
// já validado em `leave/route.test.ts` (Tarefa 3).
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
      const filtros: Record<string, unknown> = {};
      const chain = {
        select: () => chain,
        eq: (coluna: string, valor: unknown) => {
          filtros[coluna] = valor;
          return chain;
        },
        maybeSingle: async () => {
          if (!grupo) return { data: null, error: null };
          const bate = Object.entries(filtros).every(
            ([coluna, valor]) => grupo[coluna] === valor,
          );
          return { data: bate ? grupo : null, error: null };
        },
      };
      return chain;
    },
  };
}

const params = Promise.resolve({ id: 'g-1' });
const grupoBase = { id: 'g-1', account_id: 'acct-1', channel_id: 'chan-1', group_jid: '1@g.us', left_at: null };

describe('GET /api/whatsapp/groups/[id]/participants', () => {
  beforeEach(() => vi.clearAllMocks());

  it('devolve 401 sem sessao', async () => {
    mocks.createClient.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    });
    const res = await GET(new Request('https://x'), { params });
    expect(res.status).toBe(401);
  });

  it('nao exige admin para ler', async () => {
    mocks.createClient.mockResolvedValue(comSessao('viewer', grupoBase));
    mocks.getProviderForChannel.mockResolvedValue({
      getGroupParticipants: async () => [
        { phoneNumber: '553183886076', isAdmin: false },
        { phoneNumber: '553183839660', isAdmin: true },
      ],
      getConnectedNumber: async () => '553183886076',
    });

    const res = await GET(new Request('https://x'), { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.participants).toHaveLength(2);
    expect(body.isConnectedNumberAdmin).toBe(false);
  });

  it('isConnectedNumberAdmin=true quando o numero conectado e admin', async () => {
    mocks.createClient.mockResolvedValue(comSessao('viewer', grupoBase));
    mocks.getProviderForChannel.mockResolvedValue({
      getGroupParticipants: async () => [{ phoneNumber: '553183886076', isAdmin: true }],
      getConnectedNumber: async () => '553183886076',
    });

    const res = await GET(new Request('https://x'), { params });
    const body = await res.json();

    expect(body.isConnectedNumberAdmin).toBe(true);
  });

  it('devolve 404 quando o grupo ja foi deixado (left_at preenchido)', async () => {
    mocks.createClient.mockResolvedValue(
      comSessao('viewer', { ...grupoBase, left_at: '2026-09-05T00:00:00Z' }),
    );
    const res = await GET(new Request('https://x'), { params });
    expect(res.status).toBe(404);
  });

  it('devolve 404 quando o grupo pertence a outra conta', async () => {
    // O grupo EXISTE (mesmo id 'g-1') mas e de outra conta ('acct-OUTRA').
    // A sessao e da 'acct-1' -- isso prova que o filtro .eq('account_id', ...)
    // da rota bloqueia o acesso, e nao so que "grupo inexistente da 404".
    mocks.createClient.mockResolvedValue(
      comSessao('viewer', { ...grupoBase, account_id: 'acct-OUTRA' }),
    );
    const res = await GET(new Request('https://x'), { params });
    expect(res.status).toBe(404);
  });
});

describe('POST /api/whatsapp/groups/[id]/participants', () => {
  beforeEach(() => vi.clearAllMocks());

  function request(body: unknown) {
    return new Request('https://x', { method: 'POST', body: JSON.stringify(body) });
  }

  it('devolve 403 quando o chamador nao e admin', async () => {
    mocks.createClient.mockResolvedValue(comSessao('agent', grupoBase));
    const res = await POST(request({ action: 'add', phone: '5511999999999' }), { params });
    expect(res.status).toBe(403);
  });

  it('devolve 400 para action invalida', async () => {
    mocks.createClient.mockResolvedValue(comSessao('admin', grupoBase));
    const res = await POST(request({ action: 'apagar', phone: '5511999999999' }), { params });
    expect(res.status).toBe(400);
  });

  it('devolve 400 sem phone', async () => {
    mocks.createClient.mockResolvedValue(comSessao('admin', grupoBase));
    const res = await POST(request({ action: 'add' }), { params });
    expect(res.status).toBe(400);
  });

  it('devolve 404 quando o grupo ja foi deixado', async () => {
    mocks.createClient.mockResolvedValue(
      comSessao('admin', { ...grupoBase, left_at: '2026-09-05T00:00:00Z' }),
    );
    const res = await POST(request({ action: 'add', phone: '5511999999999' }), { params });
    expect(res.status).toBe(404);
  });

  it('devolve 404 quando o grupo pertence a outra conta', async () => {
    // Mesmo raciocinio do GET: o grupo existe, mas com account_id diferente
    // do da sessao -- prova o filtro .eq('account_id', ...), nao so a 404
    // generica de "nao existe".
    mocks.createClient.mockResolvedValue(
      comSessao('admin', { ...grupoBase, account_id: 'acct-OUTRA' }),
    );
    const res = await POST(request({ action: 'add', phone: '5511999999999' }), { params });
    expect(res.status).toBe(404);
  });

  it('adiciona participante e devolve a lista atualizada', async () => {
    mocks.createClient.mockResolvedValue(comSessao('admin', grupoBase));
    const updateGroupParticipants = vi.fn(async () => {});
    const atualizados = [{ phoneNumber: '5511999999999', isAdmin: false }];
    mocks.getProviderForChannel.mockResolvedValue({
      updateGroupParticipants,
      getGroupParticipants: async () => atualizados,
    });

    const res = await POST(request({ action: 'add', phone: '5511999999999' }), { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(updateGroupParticipants).toHaveBeenCalledWith({
      groupJid: '1@g.us',
      action: 'add',
      phone: '5511999999999',
    });
    expect(body.participants).toEqual(atualizados);
  });

  it('propaga erro claro quando o provider lanca (ex.: Error != 0 da uazapi)', async () => {
    mocks.createClient.mockResolvedValue(comSessao('admin', grupoBase));
    mocks.getProviderForChannel.mockResolvedValue({
      updateGroupParticipants: vi.fn(async () => {
        throw new Error('uazapi recusou a ação "add" para 5511999999999 (Error: 409)');
      }),
      getGroupParticipants: async () => [],
    });

    const res = await POST(request({ action: 'add', phone: '5511999999999' }), { params });

    expect(res.status).toBe(502);
  });
});

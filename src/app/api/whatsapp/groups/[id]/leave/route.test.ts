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

// `updateSpy`, quando passado, é chamado com o payload de todo
// `.update(...)` feito em `whatsapp_groups` -- usado para provar que a
// rota NUNCA grava `left_at` sem antes confirmar via `listGroups()`.
//
// O filtro de `whatsapp_groups` respeita de fato os `.eq(coluna, valor)`
// encadeados (comparando contra o `grupo` fornecido), simulando o AND
// que o PostgREST aplica na query real -- assim um teste que passa um
// `grupo` de OUTRA conta só "acha" o grupo se a rota não filtrar por
// `account_id`, expondo a falta de isolamento por conta.
function comSessao(
  role: string,
  grupo: Record<string, unknown> | null,
  updateSpy?: (payload: unknown) => void,
) {
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
        update: (payload: unknown) => {
          updateSpy?.(payload);
          return { eq: async () => ({ error: null }) };
        },
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
    // O grupo EXISTE (mesmo id 'g-1') mas e de outra conta ('acct-OUTRA').
    // A sessao e da 'acct-1' -- isso prova que o filtro .eq('account_id', ...)
    // da rota bloqueia o acesso, e nao so que "grupo inexistente da 404".
    mocks.createClient.mockResolvedValue(
      comSessao('admin', {
        id: 'g-1',
        account_id: 'acct-OUTRA',
        channel_id: 'chan-1',
        group_jid: '1@g.us',
      }),
    );
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
    const updateSpy = vi.fn();
    mocks.createClient.mockResolvedValue(
      comSessao(
        'admin',
        { id: 'g-1', account_id: 'acct-1', channel_id: 'chan-1', group_jid: '1@g.us' },
        updateSpy,
      ),
    );
    const leaveGroup = vi.fn(async () => {});
    const listGroups = vi.fn(async () => [{ groupJid: '1@g.us', name: 'Teste' }]); // ainda la
    mocks.getProviderForChannel.mockResolvedValue({ leaveGroup, listGroups });

    const res = await POST(request(), { params });

    expect(res.status).toBe(502);
    // Garantia real (nao so o sintoma): left_at NUNCA pode ser gravado
    // quando a reconfirmacao via listGroups() mostra que o grupo continua la.
    expect(updateSpy).not.toHaveBeenCalled();
  });
});

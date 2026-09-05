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

// O filtro de `whatsapp_groups` respeita de fato os `.eq(coluna, valor)`
// encadeados (comparando contra o `grupo` fornecido), simulando o AND
// que o PostgREST aplica na query real -- assim um teste que passa um
// `grupo` de OUTRA conta só "acha" o grupo se a rota não filtrar por
// `account_id`, expondo a falta de isolamento por conta.
function comSessao(
  role: string,
  grupo: Record<string, unknown> | null,
  updatedRows: Record<string, unknown>[],
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
        update: (row: Record<string, unknown>) => {
          updatedRows.push(row);
          return { eq: async () => ({ error: null }) };
        },
      };
      return chain;
    },
  };
}

const params = Promise.resolve({ id: 'g-1' });
const grupoBase = { id: 'g-1', account_id: 'acct-1', channel_id: 'chan-1', group_jid: '1@g.us', left_at: null };

function request(body: unknown) {
  return new Request('https://x', { method: 'POST', body: JSON.stringify(body) });
}

describe('POST /api/whatsapp/groups/[id]/name', () => {
  beforeEach(() => vi.clearAllMocks());

  it('devolve 403 quando o chamador nao e admin', async () => {
    mocks.createClient.mockResolvedValue(comSessao('agent', grupoBase, []));
    const res = await POST(request({ name: 'Novo Nome' }), { params });
    expect(res.status).toBe(403);
  });

  it('devolve 400 para nome vazio', async () => {
    mocks.createClient.mockResolvedValue(comSessao('admin', grupoBase, []));
    const res = await POST(request({ name: '   ' }), { params });
    expect(res.status).toBe(400);
  });

  it('devolve 404 quando o grupo ja foi deixado', async () => {
    mocks.createClient.mockResolvedValue(
      comSessao('admin', { ...grupoBase, left_at: '2026-09-05T00:00:00Z' }, []),
    );
    const res = await POST(request({ name: 'Novo Nome' }), { params });
    expect(res.status).toBe(404);
  });

  it('devolve 404 quando o grupo pertence a outra conta', async () => {
    // O grupo EXISTE (mesmo id 'g-1') mas e de outra conta ('acct-OUTRA').
    // A sessao e da 'acct-1' -- isso prova que o filtro .eq('account_id', ...)
    // da rota bloqueia o acesso, e nao so que "grupo inexistente da 404".
    mocks.createClient.mockResolvedValue(
      comSessao('admin', { ...grupoBase, account_id: 'acct-OUTRA' }, []),
    );
    const res = await POST(request({ name: 'Novo Nome' }), { params });
    expect(res.status).toBe(404);
  });

  it('renomeia e grava localmente sem esperar sync', async () => {
    const updatedRows: Record<string, unknown>[] = [];
    mocks.createClient.mockResolvedValue(comSessao('admin', grupoBase, updatedRows));
    const updateGroupName = vi.fn(async () => {});
    mocks.getProviderForChannel.mockResolvedValue({ updateGroupName });

    const res = await POST(request({ name: 'Novo Nome' }), { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.name).toBe('Novo Nome');
    expect(updateGroupName).toHaveBeenCalledWith('1@g.us', 'Novo Nome');
    expect(updatedRows).toEqual([{ name: 'Novo Nome' }]);
  });

  it('propaga erro claro quando o provider lanca', async () => {
    mocks.createClient.mockResolvedValue(comSessao('admin', grupoBase, []));
    mocks.getProviderForChannel.mockResolvedValue({
      updateGroupName: vi.fn(async () => {
        throw new Error('Grupo não encontrado');
      }),
    });

    const res = await POST(request({ name: 'Novo Nome' }), { params });
    expect(res.status).toBe(502);
  });
});

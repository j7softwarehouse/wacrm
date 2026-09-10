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
function comSessao(
  role: string,
  upsertedRows: Array<Record<string, unknown>>[],
  leftGroupJids: string[] = [],
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
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              in: () => ({
                not: async () => ({
                  data: leftGroupJids.map((group_jid) => ({ group_jid })),
                  error: null,
                }),
              }),
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
      };
    },
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

  it('inclui `left_at: null` no upsert — reabre um grupo re-adicionado pelo WhatsApp', async () => {
    const rows: Array<Record<string, unknown>>[] = [];
    mocks.createClient.mockResolvedValue(comSessao('admin', rows));

    await POST(request());

    expect(rows).toHaveLength(1);
    for (const row of rows[0]) {
      expect(row.left_at).toBeNull();
    }
  });

  it('religa `enabled: true` so para o grupo que estava marcado como saido', async () => {
    // '1@g.us' estava com left_at preenchido (o fake devolve ele na
    // checagem de "grupos saidos"); '2@g.us' nunca saiu. So o primeiro
    // pode receber enabled:true de volta -- o segundo precisa continuar
    // sem a coluna `enabled` no upsert dele, senao o teste anterior
    // ("preserva o valor ja ligado pelo usuario") deixaria de valer.
    const rows: Array<Record<string, unknown>>[] = [];
    mocks.createClient.mockResolvedValue(comSessao('admin', rows, ['1@g.us']));

    await POST(request());

    // Duas chamadas de upsert (uma por lote), nao uma so com colunas
    // diferentes por linha -- ver comentario no route.ts sobre o risco
    // do merge do PostgREST com colunas heterogeneas no mesmo lote.
    expect(rows).toHaveLength(2);
    const rejoined = rows.flat().find((r) => r.group_jid === '1@g.us');
    const untouched = rows.flat().find((r) => r.group_jid === '2@g.us');
    expect(rejoined).toMatchObject({ enabled: true, left_at: null });
    expect(untouched).not.toHaveProperty('enabled');
    expect(untouched?.left_at).toBeNull();
  });
});

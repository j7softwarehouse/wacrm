import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  supabaseAdmin: vi.fn(),
  getProviderForChannel: vi.fn(),
}));

vi.mock('@/lib/flows/admin-client', () => ({ supabaseAdmin: mocks.supabaseAdmin }));
vi.mock('@/lib/whatsapp/providers/resolve', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/whatsapp/providers/resolve')>();
  return { ...actual, getProviderForChannel: mocks.getProviderForChannel };
});

import { GET } from './route';

const ORIGINAL_ENV = process.env.CRON_SECRET;

function request(headers: Record<string, string> = {}) {
  return new Request('https://x/api/whatsapp/groups/sync-cron', { headers });
}

/**
 * Fake com estado: cada canal upado leva uma lista própria de grupos
 * (via `mocks.getProviderForChannel`), e o upsert de cada um vai para
 * o array `upserted` correspondente — assim um teste consegue provar
 * que TODOS os canais de TODAS as contas foram percorridos, não só o
 * primeiro.
 */
function fakeAdmin(
  channels: Array<{ id: string; account_id: string }>,
  upserted: Array<Record<string, unknown>>[],
  leftGroupJids: string[] = [],
) {
  return {
    from: (table: string) => {
      if (table === 'whatsapp_channels') {
        return {
          select: () => ({
            eq: () => ({
              eq: async () => ({ data: channels, error: null }),
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
          upserted.push(rows);
          return { select: () => Promise.resolve({ data: [], error: null }) };
        },
      };
    },
  };
}

describe('GET /api/whatsapp/groups/sync-cron', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = 'segredo-de-teste';
  });

  afterEach(() => {
    process.env.CRON_SECRET = ORIGINAL_ENV;
  });

  it('devolve 401 sem o segredo correto', async () => {
    const res = await GET(request());
    expect(res.status).toBe(401);
  });

  it('aceita o header x-cron-secret (pinger externo)', async () => {
    mocks.supabaseAdmin.mockReturnValue(fakeAdmin([], []));

    const res = await GET(request({ 'x-cron-secret': 'segredo-de-teste' }));

    expect(res.status).toBe(200);
  });

  it('aceita Authorization: Bearer (Vercel Cron nativa)', async () => {
    mocks.supabaseAdmin.mockReturnValue(fakeAdmin([], []));

    const res = await GET(request({ authorization: 'Bearer segredo-de-teste' }));

    expect(res.status).toBe(200);
  });

  it('percorre todos os canais uazapi conectados de todas as contas', async () => {
    const upserted: Array<Record<string, unknown>>[] = [];
    mocks.supabaseAdmin.mockReturnValue(
      fakeAdmin(
        [
          { id: 'chan-1', account_id: 'acct-1' },
          { id: 'chan-2', account_id: 'acct-2' },
        ],
        upserted,
      ),
    );
    mocks.getProviderForChannel.mockImplementation(async (_db: unknown, channelId: string) => ({
      listGroups: async () =>
        channelId === 'chan-1'
          ? [{ groupJid: '1@g.us', name: 'Turma A' }]
          : [
              { groupJid: '2@g.us', name: 'Turma B' },
              { groupJid: '3@g.us', name: 'Turma C' },
            ],
    }));

    const res = await GET(request({ 'x-cron-secret': 'segredo-de-teste' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.syncedChannels).toBe(2);
    expect(body.syncedGroups).toBe(3);
    expect(upserted).toHaveLength(2);

    // Prova o risco real desta rota (que a manual não tinha): cada
    // canal precisa gravar SEU PRÓPRIO account_id, não um account_id
    // fixo/do primeiro canal. Acha o lote pelo group_jid em vez de
    // supor a ordem, então um bug que trocasse os dois lotes de lugar
    // também seria pego.
    const flat = upserted.flat();
    const turmaA = flat.find((r) => r.group_jid === '1@g.us');
    const turmaB = flat.find((r) => r.group_jid === '2@g.us');
    const turmaC = flat.find((r) => r.group_jid === '3@g.us');
    expect(turmaA).toMatchObject({ account_id: 'acct-1', channel_id: 'chan-1' });
    expect(turmaB).toMatchObject({ account_id: 'acct-2', channel_id: 'chan-2' });
    expect(turmaC).toMatchObject({ account_id: 'acct-2', channel_id: 'chan-2' });
  });

  it('nao inclui `enabled` no upsert — preserva o valor ja ligado pelo usuario', async () => {
    const upserted: Array<Record<string, unknown>>[] = [];
    mocks.supabaseAdmin.mockReturnValue(
      fakeAdmin([{ id: 'chan-1', account_id: 'acct-1' }], upserted),
    );
    mocks.getProviderForChannel.mockResolvedValue({
      listGroups: async () => [{ groupJid: '1@g.us', name: 'Turma A' }],
    });

    await GET(request({ 'x-cron-secret': 'segredo-de-teste' }));

    expect(upserted).toHaveLength(1);
    for (const row of upserted[0]) {
      expect(row).not.toHaveProperty('enabled');
      expect(row.account_id).toBe('acct-1');
      expect(row.channel_id).toBe('chan-1');
    }
  });

  it('inclui `left_at: null` no upsert — reabre um grupo re-adicionado pelo WhatsApp', async () => {
    const upserted: Array<Record<string, unknown>>[] = [];
    mocks.supabaseAdmin.mockReturnValue(
      fakeAdmin([{ id: 'chan-1', account_id: 'acct-1' }], upserted),
    );
    mocks.getProviderForChannel.mockResolvedValue({
      listGroups: async () => [{ groupJid: '1@g.us', name: 'Turma A' }],
    });

    await GET(request({ 'x-cron-secret': 'segredo-de-teste' }));

    expect(upserted).toHaveLength(1);
    for (const row of upserted[0]) {
      expect(row.left_at).toBeNull();
    }
  });

  it('religa `enabled: true` so para o grupo que estava marcado como saido', async () => {
    // '1@g.us' estava com left_at preenchido; '2@g.us' nunca saiu. So o
    // primeiro pode receber enabled:true de volta -- misturar os dois
    // no MESMO upsert arriscaria zerar o enabled do segundo (ver
    // comentario no route.ts sobre colunas heterogeneas no PostgREST).
    const upserted: Array<Record<string, unknown>>[] = [];
    mocks.supabaseAdmin.mockReturnValue(
      fakeAdmin([{ id: 'chan-1', account_id: 'acct-1' }], upserted, ['1@g.us']),
    );
    mocks.getProviderForChannel.mockResolvedValue({
      listGroups: async () => [
        { groupJid: '1@g.us', name: 'Turma A' },
        { groupJid: '2@g.us', name: 'Turma B' },
      ],
    });

    await GET(request({ 'x-cron-secret': 'segredo-de-teste' }));

    expect(upserted).toHaveLength(2);
    const rejoined = upserted.flat().find((r) => r.group_jid === '1@g.us');
    const untouched = upserted.flat().find((r) => r.group_jid === '2@g.us');
    expect(rejoined).toMatchObject({ enabled: true, left_at: null });
    expect(untouched).not.toHaveProperty('enabled');
    expect(untouched?.left_at).toBeNull();
  });

  it('erro em um canal nao impede a sincronizacao dos demais', async () => {
    const upserted: Array<Record<string, unknown>>[] = [];
    mocks.supabaseAdmin.mockReturnValue(
      fakeAdmin(
        [
          { id: 'chan-quebrado', account_id: 'acct-1' },
          { id: 'chan-ok', account_id: 'acct-2' },
        ],
        upserted,
      ),
    );
    mocks.getProviderForChannel.mockImplementation(async (_db: unknown, channelId: string) => {
      if (channelId === 'chan-quebrado') {
        return {
          listGroups: async () => {
            throw new Error('uazapi fora do ar');
          },
        };
      }
      return { listGroups: async () => [{ groupJid: '9@g.us', name: 'OK' }] };
    });

    const res = await GET(request({ 'x-cron-secret': 'segredo-de-teste' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.syncedChannels).toBe(1);
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0]).toMatch(/chan-quebrado/);
  });
});

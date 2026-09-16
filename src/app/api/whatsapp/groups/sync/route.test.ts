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
interface LeftQueryCall {
  accountId: string;
  channelId: string;
  groupJids: string[];
}

/**
 * `leftQueryArgs`, quando passado, captura os argumentos REAIS de
 * `.eq(account_id).eq(channel_id).in(group_jids)` — sem isso, um bug
 * que trocasse o escopo (ex.: esquecer o filtro por `channel_id`)
 * passaria despercebido, já que o retorno fixo (`leftGroupJids`) não
 * depende de nada que a rota realmente mandou.
 *
 * `failUpsertFor`, quando passado, faz o upsert de um lote específico
 * falhar (para provar que o OUTRO lote, independente, ainda roda).
 */
function comSessao(
  role: string,
  upsertedRows: Array<Record<string, unknown>>[],
  options: {
    leftGroupJids?: string[];
    leftQueryArgs?: LeftQueryCall[];
    failUpsertFor?: (rows: Array<Record<string, unknown>>) => boolean;
  } = {},
) {
  const { leftGroupJids = [], leftQueryArgs, failUpsertFor } = options;
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
          eq: (_col1: string, accountId: string) => ({
            eq: (_col2: string, channelId: string) => ({
              in: (_col3: string, groupJids: string[]) => ({
                not: async () => {
                  leftQueryArgs?.push({ accountId, channelId, groupJids });
                  return {
                    data: leftGroupJids.map((group_jid) => ({ group_jid })),
                    error: null,
                  };
                },
              }),
            }),
          }),
        }),
        upsert: (rows: Array<Record<string, unknown>>) => {
          upsertedRows.push(rows);
          if (failUpsertFor?.(rows)) {
            return {
              select: () =>
                Promise.resolve({ data: null, error: { message: 'upsert falhou' } }),
            };
          }
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

  it('religa `enabled: true` so para o grupo que estava marcado como saido, checando o escopo da consulta', async () => {
    // '1@g.us' estava com left_at preenchido (o fake devolve ele na
    // checagem de "grupos saidos"); '2@g.us' nunca saiu. So o primeiro
    // pode receber enabled:true de volta -- o segundo precisa continuar
    // sem a coluna `enabled` no upsert dele, senao o teste anterior
    // ("preserva o valor ja ligado pelo usuario") deixaria de valer.
    const rows: Array<Record<string, unknown>>[] = [];
    const leftQueryArgs: LeftQueryCall[] = [];
    mocks.createClient.mockResolvedValue(
      comSessao('admin', rows, { leftGroupJids: ['1@g.us'], leftQueryArgs }),
    );

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

    // Prova o escopo de verdade da consulta "quem esta marcado como
    // saido" -- sem isto, remover o filtro por conta/canal (vazando a
    // checagem entre contas ou canais) passaria despercebido, ja que o
    // fake devolveria leftGroupJids de qualquer jeito.
    expect(leftQueryArgs).toHaveLength(1);
    expect(leftQueryArgs[0]).toEqual({
      accountId: 'acct-1',
      channelId: 'chan-1',
      groupJids: ['1@g.us', '2@g.us'],
    });
  });

  it('lote de grupos readicionados falhando nao impede o lote normal', async () => {
    // '1@g.us' e o rejoin (ganha enabled:true, upsert desse lote falha
    // de proposito); '2@g.us' e normal e precisa continuar indo pro
    // banco mesmo assim -- os dois lotes sao independentes.
    const rows: Array<Record<string, unknown>>[] = [];
    mocks.createClient.mockResolvedValue(
      comSessao('admin', rows, {
        leftGroupJids: ['1@g.us'],
        failUpsertFor: (batch) => batch.some((r) => r.enabled === true),
      }),
    );

    const res = await POST(request());
    const body = await res.json();

    expect(res.status).toBe(200);
    // Os dois lotes foram tentados, mesmo o primeiro tendo falhado.
    expect(rows).toHaveLength(2);
    // So o lote normal (1 grupo) contou.
    expect(body.synced).toBe(1);
  });
});

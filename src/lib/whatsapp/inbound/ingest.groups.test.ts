import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  dispatchInboundToFlows: vi.fn(),
  runAutomationsForTrigger: vi.fn(),
  resolveGroupConversation: vi.fn(),
}));

vi.mock('@/lib/flows/engine', () => ({
  dispatchInboundToFlows: mocks.dispatchInboundToFlows,
}));
vi.mock('@/lib/automations/engine', () => ({
  runAutomationsForTrigger: mocks.runAutomationsForTrigger,
}));
vi.mock('@/lib/whatsapp/groups/resolve-group-conversation', () => ({
  resolveGroupConversation: mocks.resolveGroupConversation,
}));

import { shouldDispatchEngines, ingestInboundMessage } from './ingest';
import type { SupabaseClient } from '@supabase/supabase-js';

describe('shouldDispatchEngines', () => {
  beforeEach(() => vi.clearAllMocks());

  it('permite disparo em mensagem 1:1', () => {
    expect(shouldDispatchEngines({ group: undefined })).toBe(true);
  });

  it('BLOQUEIA disparo em mensagem de grupo', () => {
    // Sem esta trava o bot responde dentro de grupos — inclusive
    // grupos pessoais do numero conectado. A mensagem indevida ja
    // foi entregue a terceiros quando o erro aparece; nao ha desfazer.
    expect(
      shouldDispatchEngines({
        group: {
          groupJid: '123@g.us',
          participantJid: '5511999999999@s.whatsapp.net',
        },
      }),
    ).toBe(false);
  });
});

const CANAL = {
  id: 'ch-1',
  account_id: 'acct-1',
  user_id: 'user-1',
  provider: 'uazapi',
  status: 'connected',
} as never;

const GRUPO = {
  groupJid: '120363000000000000@g.us',
  participantJid: '5511999999999@s.whatsapp.net',
};

/** Captura inserts por tabela e devolve linhas com id previsível. */
function fakeDb(porTabela: Record<string, Record<string, unknown>[]>) {
  return {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
            single: async () => ({ data: null, error: null }),
          }),
          maybeSingle: async () => ({ data: null, error: null }),
        }),
      }),
      insert: (row: Record<string, unknown>) => {
        (porTabela[table] ??= []).push(row);
        return {
          select: () => ({
            single: async () => ({ data: { id: `${table}-1`, ...row }, error: null }),
          }),
        };
      },
      update: () => ({ eq: async () => ({ error: null }) }),
    }),
  } as unknown as SupabaseClient;
}

describe('ingestInboundMessage — mensagem de grupo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveGroupConversation.mockResolvedValue({
      conversationId: 'cv-1',
      groupId: 'grp-1',
      participantId: 'p-1',
    });
  });

  it('grava mensagem de grupo com participant_id e sender_type customer', async () => {
    // sender_type continua 'customer': quem fala nao e da nossa equipe.
    // Nao se cria valor novo no enum para nao quebrar consumidores.
    const porTabela: Record<string, Record<string, unknown>[]> = {};

    await ingestInboundMessage(fakeDb(porTabela), {
      channel: CANAL,
      from: '5511999999999',
      providerMessageId: 'wamid-1',
      timestamp: Math.floor(Date.now() / 1000),
      content: { type: 'text', text: 'oi grupo' },
      group: GRUPO,
    });

    expect(porTabela['messages']?.[0]).toMatchObject({
      conversation_id: 'cv-1',
      sender_type: 'customer',
      participant_id: 'p-1',
      content_text: 'oi grupo',
    });
  });

  it('NAO cria contato para participante de grupo', async () => {
    // Requisito duro: participante nunca entra na base de contatos.
    const porTabela: Record<string, Record<string, unknown>[]> = {};

    await ingestInboundMessage(fakeDb(porTabela), {
      channel: CANAL,
      from: '5511999999999',
      providerMessageId: 'wamid-2',
      timestamp: Math.floor(Date.now() / 1000),
      content: { type: 'text', text: 'oi' },
      group: GRUPO,
    });

    expect(porTabela['contacts']).toBeUndefined();
  });

  it('descarta quando o grupo nao esta habilitado', async () => {
    mocks.resolveGroupConversation.mockResolvedValue(null);
    const porTabela: Record<string, Record<string, unknown>[]> = {};

    const r = await ingestInboundMessage(fakeDb(porTabela), {
      channel: CANAL,
      from: '5511999999999',
      providerMessageId: 'wamid-3',
      timestamp: Math.floor(Date.now() / 1000),
      content: { type: 'text', text: 'oi' },
      group: GRUPO,
    });

    expect(r).toBeNull();
    expect(porTabela['messages']).toBeUndefined();
  });
});

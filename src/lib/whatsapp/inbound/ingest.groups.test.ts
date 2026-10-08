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
      update: (row: Record<string, unknown>) => ({
        eq: async () => {
          (porTabela[`${table}:update`] ??= []).push(row);
          return { error: null };
        },
      }),
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

  it('grava mensagem de grupo com status permitido pela CHECK constraint real', async () => {
    // messages.status tem CHECK (status IN ('sending','sent','delivered',
    // 'read','failed')) desde a migration inicial — nunca alterada para
    // incluir 'received'. O fake de banco não simula CHECK constraint (só
    // reentrega o valor no insert.select().single()), então este teste
    // precisa afirmar o VALOR gravado, não confiar em um erro de banco
    // fake. O caminho 1:1 (ingestInboundMessage, mesmo arquivo) já usa
    // 'delivered' para o mesmo cenário — mensagem recebida de um cliente.
    const ALLOWED_STATUS = ['sending', 'sent', 'delivered', 'read', 'failed'];
    const porTabela: Record<string, Record<string, unknown>[]> = {};

    await ingestInboundMessage(fakeDb(porTabela), {
      channel: CANAL,
      from: '5511999999999',
      providerMessageId: 'wamid-status-1',
      timestamp: Math.floor(Date.now() / 1000),
      content: { type: 'text', text: 'oi grupo' },
      group: GRUPO,
    });

    const status = porTabela['messages']?.[0]?.status;
    expect(ALLOWED_STATUS).toContain(status);
  });

  it('normaliza content_type sticker para image', async () => {
    // Figurinhas são comuns em grupos, mas a CHECK constraint de
    // messages.content_type só aceita tipos permitidos — sticker não está
    // na lista. toDbContentType já mapeia sticker → image, e o caminho 1:1
    // usa este helper (linha ~656). O caminho de grupo deve fazer o mesmo
    // para evitar violação de constraint.
    const porTabela: Record<string, Record<string, unknown>[]> = {};

    await ingestInboundMessage(fakeDb(porTabela), {
      channel: CANAL,
      from: '5511999999999',
      providerMessageId: 'wamid-sticker-1',
      timestamp: Math.floor(Date.now() / 1000),
      content: { type: 'sticker' },
      group: GRUPO,
    });

    expect(porTabela['messages']?.[0]).toMatchObject({
      conversation_id: 'cv-1',
      sender_type: 'customer',
      content_type: 'image',
    });
  });
});

describe('ingestInboundMessage — grupo: created_at e last_message_at usam o timestamp real', () => {
  beforeEach(() => vi.clearAllMocks());

  it('grava created_at a partir de params.timestamp, não de now() — essencial pra recuperação manual de mensagem antiga', async () => {
    mocks.resolveGroupConversation.mockResolvedValue({
      conversationId: 'cv-1',
      groupId: 'grp-1',
      participantId: 'p-1',
      unreadCount: 0,
      status: 'open',
      lastMessageAt: null,
    });
    const porTabela: Record<string, Record<string, unknown>[]> = {};
    const timestampAntigo = Math.floor(Date.parse('2026-10-07T12:00:00.000Z') / 1000);

    await ingestInboundMessage(fakeDb(porTabela), {
      channel: CANAL,
      from: '5511999999999',
      providerMessageId: 'wamid-antigo-1',
      timestamp: timestampAntigo,
      content: { type: 'text', text: 'mensagem recuperada' },
      group: GRUPO,
    });

    expect(porTabela['messages']?.[0]?.created_at).toBe('2026-10-07T12:00:00.000Z');
  });

  it('NÃO regride last_message_at/text quando a conversa já tem mensagem mais recente que a sendo gravada', async () => {
    mocks.resolveGroupConversation.mockResolvedValue({
      conversationId: 'cv-1',
      groupId: 'grp-1',
      participantId: 'p-1',
      unreadCount: 0,
      status: 'open',
      lastMessageAt: '2026-10-07T18:00:00.000Z', // já tem algo mais novo
    });
    const porTabela: Record<string, Record<string, unknown>[]> = {};
    const timestampAntigo = Math.floor(Date.parse('2026-10-07T12:00:00.000Z') / 1000);

    await ingestInboundMessage(fakeDb(porTabela), {
      channel: CANAL,
      from: '5511999999999',
      providerMessageId: 'wamid-antigo-2',
      timestamp: timestampAntigo,
      content: { type: 'text', text: 'mensagem recuperada, mais antiga' },
      group: GRUPO,
    });

    const update = porTabela['conversations:update']?.[0];
    expect(update?.last_message_text).toBeUndefined();
    expect(update?.last_message_at).toBeUndefined();
  });

  it('ATUALIZA last_message_at quando a mensagem gravada é de fato a mais recente (comportamento normal)', async () => {
    mocks.resolveGroupConversation.mockResolvedValue({
      conversationId: 'cv-1',
      groupId: 'grp-1',
      participantId: 'p-1',
      unreadCount: 0,
      status: 'open',
      lastMessageAt: '2026-10-07T10:00:00.000Z', // mais antiga que a que está chegando
    });
    const porTabela: Record<string, Record<string, unknown>[]> = {};
    const timestampNovo = Math.floor(Date.parse('2026-10-07T12:00:00.000Z') / 1000);

    await ingestInboundMessage(fakeDb(porTabela), {
      channel: CANAL,
      from: '5511999999999',
      providerMessageId: 'wamid-novo-1',
      timestamp: timestampNovo,
      content: { type: 'text', text: 'mensagem nova' },
      group: GRUPO,
    });

    const update = porTabela['conversations:update']?.[0];
    expect(update?.last_message_text).toBe('mensagem nova');
    expect(update?.last_message_at).toBe('2026-10-07T12:00:00.000Z');
  });
});

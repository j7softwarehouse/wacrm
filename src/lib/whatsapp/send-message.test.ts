import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  sendMessageToConversation,
  SendMessageError,
  type SendMessageParams,
} from './send-message';

const mocks = vi.hoisted(() => ({
  getProviderForConversation: vi.fn(),
}));

vi.mock('@/lib/whatsapp/providers/resolve', () => ({
  getProviderForConversation: mocks.getProviderForConversation,
}));

// A db that explodes if touched — these tests cover the param
// validation that MUST short-circuit before any query runs.
function noDb(): SupabaseClient {
  return {
    from() {
      throw new Error('db should not be queried for invalid params');
    },
  } as unknown as SupabaseClient;
}

async function expectSendError(
  params: SendMessageParams,
  status: number,
  messageMatch?: RegExp
) {
  await expect(
    sendMessageToConversation(noDb(), 'acct-1', params)
  ).rejects.toBeInstanceOf(SendMessageError);
  await sendMessageToConversation(noDb(), 'acct-1', params).catch(
    (e: SendMessageError) => {
      expect(e.status).toBe(status);
      if (messageMatch) expect(e.message).toMatch(messageMatch);
    }
  );
}

describe('sendMessageToConversation — param validation (pre-DB)', () => {
  const base = { conversationId: 'cv-1' };

  it('requires conversation_id and message_type', async () => {
    await expectSendError({ conversationId: '', messageType: 'text' }, 400);
    await expectSendError({ conversationId: 'cv-1', messageType: '' }, 400);
  });

  it('rejects an unsupported message_type', async () => {
    await expectSendError(
      { ...base, messageType: 'carrier-pigeon' },
      400,
      /Unsupported message_type/
    );
  });

  it('requires content_text for text messages', async () => {
    await expectSendError(
      { ...base, messageType: 'text' },
      400,
      /content_text is required/
    );
  });

  it('requires template_name for template messages', async () => {
    await expectSendError(
      { ...base, messageType: 'template' },
      400,
      /template_name is required/
    );
  });

  it('requires media_url for media kinds', async () => {
    for (const kind of ['image', 'video', 'document', 'audio']) {
      await expectSendError(
        { ...base, messageType: kind },
        400,
        /media_url is required/
      );
    }
  });

  it('rejects an over-long media caption (non-audio)', async () => {
    await expectSendError(
      {
        ...base,
        messageType: 'image',
        mediaUrl: 'https://x/y.jpg',
        contentText: 'a'.repeat(1025),
      },
      400,
      /1024-character limit/
    );
  });

  it('requires a valid interactive payload for interactive messages', async () => {
    // Missing payload entirely.
    await expectSendError(
      { ...base, messageType: 'interactive' },
      400,
      /payload is required/
    );
    // Too many buttons.
    await expectSendError(
      {
        ...base,
        messageType: 'interactive',
        interactivePayload: {
          kind: 'buttons',
          body: 'Pick one',
          buttons: [
            { id: 'a', title: 'A' },
            { id: 'b', title: 'B' },
            { id: 'c', title: 'C' },
            { id: 'd', title: 'D' },
          ],
        },
      },
      400,
      /at most 3 buttons/
    );
    // Over-long button title.
    await expectSendError(
      {
        ...base,
        messageType: 'interactive',
        interactivePayload: {
          kind: 'buttons',
          body: 'Pick one',
          buttons: [{ id: 'a', title: 'x'.repeat(21) }],
        },
      },
      400,
      /20-character limit/
    );
  });

  it('allows a long "caption" on audio (audio carries none) — so it reaches the DB', async () => {
    // Audio is exempt from the caption cap, so validation passes and we
    // proceed to the conversation lookup — proven by the stub throwing.
    const spy = vi.fn(() => {
      throw new Error('reached DB');
    });
    const db = { from: spy } as unknown as SupabaseClient;
    await expect(
      sendMessageToConversation(db, 'acct-1', {
        ...base,
        messageType: 'audio',
        mediaUrl: 'https://x/y.ogg',
        contentText: 'a'.repeat(2000),
      })
    ).rejects.toThrow('reached DB');
    expect(spy).toHaveBeenCalledWith('conversations');
  });
});

describe('SendMessageError', () => {
  it('carries a machine code and an HTTP status', () => {
    const e = new SendMessageError('meta_error', 'boom', 502);
    expect(e.code).toBe('meta_error');
    expect(e.status).toBe(502);
    expect(e).toBeInstanceOf(Error);
  });
});

describe('sendMessageToConversation — autoria', () => {
  beforeEach(() => {
    mocks.getProviderForConversation.mockResolvedValue({
      sendText: async () => ({ messageId: 'wamid-1' }),
    });
  });

  it('grava sender_id com o senderUserId passado', async () => {
    // Regressão: `sender_id` existia no banco desde a 001 mas nenhum
    // caminho de envio o preenchia, então todo histórico enviado ficou
    // sem autor. O contrato precisa carregar o autor até o insert —
    // este teste verifica que de fato chega lá.
    const insertedRows: Record<string, unknown>[] = [];

    const db = {
      from: (table: string) => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              single: async () => ({
                data: {
                  id: 'cv-1',
                  account_id: 'acct-1',
                  contact: {
                    id: 'contact-1',
                    phone: '+5511987654321',
                  },
                },
                error: null,
              }),
              maybeSingle: async () => ({ data: null, error: null }),
            }),
            // Shape used by the sender-profile lookup (single eq).
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        }),
        insert: (row: Record<string, unknown>) => {
          insertedRows.push(row);
          return {
            select: () => ({
              single: async () => ({
                data: { id: 'msg-1', ...row },
                error: null,
              }),
            }),
          };
        },
        update: () => ({
          eq: async () => ({}),
        }),
      }),
    } as unknown as SupabaseClient;

    const result = await sendMessageToConversation(db, 'acct-1', {
      conversationId: 'cv-1',
      messageType: 'text',
      contentText: 'oi',
      senderUserId: 'user-1',
    });

    expect(result.messageId).toBe('msg-1');
    expect(insertedRows).toHaveLength(1);
    expect(insertedRows[0].sender_id).toBe('user-1');
  });

  it('grava sender_id como null quando senderUserId não é passado', async () => {
    // Envios sem humano por trás (automação, broadcast, API pública)
    // devem ter sender_id nulo para manter a distinção de origem —
    // este teste garante que não exigir senderUserId continua funcionando.
    const insertedRows: Record<string, unknown>[] = [];

    const db = {
      from: (table: string) => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              single: async () => ({
                data: {
                  id: 'cv-1',
                  account_id: 'acct-1',
                  contact: {
                    id: 'contact-1',
                    phone: '+5511987654321',
                  },
                },
                error: null,
              }),
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
        }),
        insert: (row: Record<string, unknown>) => {
          insertedRows.push(row);
          return {
            select: () => ({
              single: async () => ({
                data: { id: 'msg-1', ...row },
                error: null,
              }),
            }),
          };
        },
        update: () => ({
          eq: async () => ({}),
        }),
      }),
    } as unknown as SupabaseClient;

    const result = await sendMessageToConversation(db, 'acct-1', {
      conversationId: 'cv-1',
      messageType: 'text',
      contentText: 'oi',
    });

    expect(result.messageId).toBe('msg-1');
    expect(insertedRows).toHaveLength(1);
    expect(insertedRows[0].sender_id).toBe(null);
  });
});

describe('sendMessageToConversation — assinatura do atendente', () => {
  function dbWithProfile(fullName: string | null) {
    const insertedRows: Record<string, unknown>[] = [];
    const db = {
      from: (table: string) => {
        if (table === 'profiles') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: fullName ? { full_name: fullName } : null,
                  error: null,
                }),
              }),
            }),
          };
        }
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                single: async () => ({
                  data: {
                    id: 'cv-1',
                    account_id: 'acct-1',
                    contact: { id: 'contact-1', phone: '+5511987654321' },
                  },
                  error: null,
                }),
                maybeSingle: async () => ({ data: null, error: null }),
              }),
            }),
          }),
          insert: (row: Record<string, unknown>) => {
            insertedRows.push(row);
            return {
              select: () => ({
                single: async () => ({
                  data: { id: 'msg-1', ...row },
                  error: null,
                }),
              }),
            };
          },
          update: () => ({ eq: async () => ({}) }),
        };
      },
    } as unknown as SupabaseClient;
    return { db, insertedRows };
  }

  it('assina o texto enviado ao provider com o nome do atendente', async () => {
    const sendText = vi.fn(async () => ({ messageId: 'wamid-1' }));
    mocks.getProviderForConversation.mockResolvedValue({ sendText });

    const { db } = dbWithProfile('Ramon Paula');

    await sendMessageToConversation(db, 'acct-1', {
      conversationId: 'cv-1',
      messageType: 'text',
      contentText: 'Oi, tudo bem?',
      senderUserId: 'user-1',
    });

    expect(sendText).toHaveBeenCalledWith(
      expect.objectContaining({ text: '*Ramon Paula:*\nOi, tudo bem?' })
    );
  });

  it('mantém content_text salvo no banco sem o prefixo', async () => {
    const sendText = vi.fn(async () => ({ messageId: 'wamid-1' }));
    mocks.getProviderForConversation.mockResolvedValue({ sendText });

    const { db, insertedRows } = dbWithProfile('Ramon Paula');

    await sendMessageToConversation(db, 'acct-1', {
      conversationId: 'cv-1',
      messageType: 'text',
      contentText: 'Oi, tudo bem?',
      senderUserId: 'user-1',
    });

    expect(insertedRows[0].content_text).toBe('Oi, tudo bem?');
  });

  it('não assina quando o perfil não tem full_name', async () => {
    const sendText = vi.fn(async () => ({ messageId: 'wamid-1' }));
    mocks.getProviderForConversation.mockResolvedValue({ sendText });

    const { db } = dbWithProfile(null);

    await sendMessageToConversation(db, 'acct-1', {
      conversationId: 'cv-1',
      messageType: 'text',
      contentText: 'Oi, tudo bem?',
      senderUserId: 'user-1',
    });

    expect(sendText).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Oi, tudo bem?' })
    );
  });

  it('não assina quando não há senderUserId (automação/fluxo/API)', async () => {
    const sendText = vi.fn(async () => ({ messageId: 'wamid-1' }));
    mocks.getProviderForConversation.mockResolvedValue({ sendText });

    const { db } = dbWithProfile('Ramon Paula');

    await sendMessageToConversation(db, 'acct-1', {
      conversationId: 'cv-1',
      messageType: 'text',
      contentText: 'Oi, tudo bem?',
    });

    expect(sendText).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Oi, tudo bem?' })
    );
  });
});

describe('sendMessageToConversation — conversa de grupo', () => {
  beforeEach(() => {
    mocks.getProviderForConversation.mockResolvedValue({
      sendText: async () => ({ messageId: 'wamid-grupo-1' }),
    });
  });

  /** Conversa de grupo: sem contato, com `group` embutido pela query. */
  function groupDb(capture: { rows: Record<string, unknown>[]; tables: string[] }) {
    return {
      from: (table: string) => {
        capture.tables.push(table);
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                single: async () => ({
                  data: {
                    id: 'cv-grupo',
                    account_id: 'acct-1',
                    contact_id: null,
                    group_id: 'grp-1',
                    contact: null,
                    group: { id: 'grp-1', group_jid: '120363000000000000@g.us' },
                  },
                  error: null,
                }),
                maybeSingle: async () => ({ data: null, error: null }),
              }),
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
          insert: (row: Record<string, unknown>) => {
            capture.rows.push(row);
            return {
              select: () => ({
                single: async () => ({ data: { id: 'msg-grupo-1', ...row }, error: null }),
              }),
            };
          },
          update: () => ({ eq: async () => ({ error: null }) }),
        };
      },
    } as unknown as SupabaseClient;
  }

  it('envia texto para o JID do grupo em vez de telefone', async () => {
    const sendText = vi.fn(async () => ({ messageId: 'wamid-grupo-1' }));
    mocks.getProviderForConversation.mockResolvedValue({ sendText });
    const capture = { rows: [] as Record<string, unknown>[], tables: [] as string[] };

    const result = await sendMessageToConversation(groupDb(capture), 'acct-1', {
      conversationId: 'cv-grupo',
      messageType: 'text',
      contentText: 'oi grupo',
      senderUserId: 'user-1',
    });

    expect(sendText).toHaveBeenCalledWith(
      expect.objectContaining({ to: '120363000000000000@g.us' }),
    );
    expect(result.messageId).toBe('msg-grupo-1');
  });

  it('NAO toca na tabela contacts ao enviar em grupo', async () => {
    // Requisito duro da Fase 1 que a Fase 2 nao pode quebrar: a
    // auto-correcao de telefone do caminho 1:1 grava em `contacts`, e
    // conversa de grupo nao tem contato nenhum para corrigir.
    const capture = { rows: [] as Record<string, unknown>[], tables: [] as string[] };

    await sendMessageToConversation(groupDb(capture), 'acct-1', {
      conversationId: 'cv-grupo',
      messageType: 'text',
      contentText: 'oi',
      senderUserId: 'user-1',
    });

    expect(capture.tables).not.toContain('contacts');
  });

  it('grava a mensagem enviada com sender_id do operador e sem participant_id', async () => {
    const capture = { rows: [] as Record<string, unknown>[], tables: [] as string[] };

    await sendMessageToConversation(groupDb(capture), 'acct-1', {
      conversationId: 'cv-grupo',
      messageType: 'text',
      contentText: 'oi',
      senderUserId: 'user-1',
    });

    const message = capture.rows.find((r) => r.sender_type === 'agent');
    expect(message).toMatchObject({
      conversation_id: 'cv-grupo',
      sender_type: 'agent',
      sender_id: 'user-1',
    });
    // participant_id identifica quem escreveu numa mensagem RECEBIDA;
    // mensagem enviada e do nosso time, o autor vem de sender_id.
    expect(message?.participant_id).toBeUndefined();
  });

  it('recusa conversa de grupo cujo grupo nao foi encontrado', async () => {
    const db = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              single: async () => ({
                data: {
                  id: 'cv-grupo',
                  account_id: 'acct-1',
                  contact_id: null,
                  group_id: 'grp-sumiu',
                  contact: null,
                  group: null,
                },
                error: null,
              }),
            }),
          }),
        }),
      }),
    } as unknown as SupabaseClient;

    await expect(
      sendMessageToConversation(db, 'acct-1', {
        conversationId: 'cv-grupo',
        messageType: 'text',
        contentText: 'oi',
        senderUserId: 'user-1',
      }),
    ).rejects.toBeInstanceOf(SendMessageError);
  });

  it('assina a mensagem de grupo com o nome do atendente', async () => {
    // Em grupo a assinatura importa mais que no 1:1: varias pessoas leem,
    // e sem ela ninguem sabe qual atendente respondeu.
    const sendText = vi.fn(async () => ({ messageId: 'wamid-grupo-1' }));
    mocks.getProviderForConversation.mockResolvedValue({ sendText });

    const db = {
      from: (table: string) => {
        if (table === 'profiles') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { full_name: 'Ramon Paula' },
                  error: null,
                }),
              }),
            }),
          };
        }
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                single: async () => ({
                  data: {
                    id: 'cv-grupo',
                    account_id: 'acct-1',
                    contact_id: null,
                    group_id: 'grp-1',
                    contact: null,
                    group: { id: 'grp-1', group_jid: '120363000000000000@g.us' },
                  },
                  error: null,
                }),
                maybeSingle: async () => ({ data: null, error: null }),
              }),
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
          insert: (row: Record<string, unknown>) => ({
            select: () => ({
              single: async () => ({ data: { id: 'msg-1', ...row }, error: null }),
            }),
          }),
          update: () => ({ eq: async () => ({ error: null }) }),
        };
      },
    } as unknown as SupabaseClient;

    await sendMessageToConversation(db, 'acct-1', {
      conversationId: 'cv-grupo',
      messageType: 'text',
      contentText: 'bom dia',
      senderUserId: 'user-1',
    });

    expect(sendText).toHaveBeenCalledWith(
      expect.objectContaining({ text: '*Ramon Paula:*\nbom dia' }),
    );
  });

  it('recusa mensagem interativa em conversa de grupo, sem chamar o provider', async () => {
    // Achado da revisao final: a spec e o criterio de aceite 7 dizem
    // que interativo (botoes/listas) e template nao podem ir para
    // grupo. O backend precisa recusar mesmo que a UI deixe passar —
    // e recusar ANTES de tentar o provider, nao so acabar em erro por
    // acaso (o mock global de `sendText` nao teria `sendInteractiveButtons`
    // de qualquer jeito, o que mascararia uma falta de guard real).
    const sendInteractiveButtons = vi.fn(async () => ({ messageId: 'wamid-x' }));
    mocks.getProviderForConversation.mockResolvedValue({
      sendText: async () => ({ messageId: 'wamid-x' }),
      sendInteractiveButtons,
    });
    const capture = { rows: [] as Record<string, unknown>[], tables: [] as string[] };

    const err = await sendMessageToConversation(groupDb(capture), 'acct-1', {
      conversationId: 'cv-grupo',
      messageType: 'interactive',
      senderUserId: 'user-1',
      interactivePayload: {
        kind: 'buttons',
        body: 'Pick one',
        buttons: [{ id: 'a', title: 'A' }],
      },
    }).catch((e) => e);

    expect(err).toBeInstanceOf(SendMessageError);
    expect((err as InstanceType<typeof SendMessageError>).code).toBe('bad_request');
    expect(sendInteractiveButtons).not.toHaveBeenCalled();
  });

  it('recusa mensagem de template em conversa de grupo, sem chamar o provider', async () => {
    const sendTemplate = vi.fn(async () => ({ messageId: 'wamid-x' }));
    mocks.getProviderForConversation.mockResolvedValue({
      sendText: async () => ({ messageId: 'wamid-x' }),
      sendTemplate,
    });
    const capture = { rows: [] as Record<string, unknown>[], tables: [] as string[] };

    const err = await sendMessageToConversation(groupDb(capture), 'acct-1', {
      conversationId: 'cv-grupo',
      messageType: 'template',
      templateName: 'saudacao',
      senderUserId: 'user-1',
    }).catch((e) => e);

    expect(err).toBeInstanceOf(SendMessageError);
    expect((err as InstanceType<typeof SendMessageError>).code).toBe('bad_request');
    expect(sendTemplate).not.toHaveBeenCalled();
  });

  it('recusa envio quando o numero ja saiu do grupo (left_at preenchido)', async () => {
    const capture = { rows: [] as Record<string, unknown>[], tables: [] as string[] };
    const db = {
      from: (table: string) => {
        capture.tables.push(table);
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                single: async () => ({
                  data: {
                    id: 'cv-grupo',
                    account_id: 'acct-1',
                    contact_id: null,
                    group_id: 'grp-1',
                    contact: null,
                    group: { id: 'grp-1', group_jid: '120363000000000000@g.us', left_at: '2026-09-05T00:00:00Z' },
                  },
                  error: null,
                }),
                maybeSingle: async () => ({ data: null, error: null }),
              }),
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
          insert: (row: Record<string, unknown>) => {
            capture.rows.push(row);
            return { select: () => ({ single: async () => ({ data: { id: 'msg-1', ...row }, error: null }) }) };
          },
          update: () => ({ eq: async () => ({ error: null }) }),
        };
      },
    } as unknown as SupabaseClient;

    const err = await sendMessageToConversation(db, 'acct-1', {
      conversationId: 'cv-grupo',
      messageType: 'text',
      contentText: 'oi',
      senderUserId: 'user-1',
    }).catch((e) => e);

    expect(err).toBeInstanceOf(SendMessageError);
    expect((err as InstanceType<typeof SendMessageError>).code).toBe('bad_request');
    expect(capture.tables).not.toContain('contacts');
  });
});

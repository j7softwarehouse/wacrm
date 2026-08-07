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

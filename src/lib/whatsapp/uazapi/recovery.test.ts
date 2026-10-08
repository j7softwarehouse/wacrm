import { describe, expect, it, vi } from 'vitest';

import { recoverMessages } from './recovery';
import type { ReadOnlyUazapiClient } from './recovery-preview';

const WINDOW = { sinceMs: 1_700_000_000_000, untilMs: 1_700_003_600_000 };

const CHANNEL = { id: 'chan-1', account_id: 'acct-1' } as never;

function fakeUazapiClient(handlers: Record<string, unknown[]>): ReadOnlyUazapiClient {
  const calls: Record<string, number> = {};
  const post = vi.fn(async (path: string) => {
    const i = calls[path] ?? 0;
    calls[path] = i + 1;
    const seq = handlers[path];
    if (!seq) throw new Error(`sem resposta programada para ${path}`);
    return seq[Math.min(i, seq.length - 1)];
  });
  return { post } as unknown as ReadOnlyUazapiClient;
}

function fakeDb(existingMessageIds: string[] = []) {
  const inserted: Record<string, unknown>[] = [];
  const ingestInboundMessage = vi.fn(async (_db, params) => {
    inserted.push(params);
    return { messageId: `msg-${inserted.length}`, conversationId: 'conv-1', contactId: 'ct-1', deduped: false };
  });
  return {
    db: {
      from: () => ({
        select: () => ({
          in: async () => ({ data: existingMessageIds.map((message_id) => ({ message_id })), error: null }),
        }),
      }),
    } as never,
    ingestInboundMessage,
    inserted,
  };
}

function fakeProvider(resolveInboundMediaUrl = vi.fn(async (ref: string) => `https://storage/${ref}`)) {
  return { resolveInboundMediaUrl } as never;
}

describe('recoverMessages', () => {
  it('ingere uma mensagem de texto nova com suppressEngines: true', async () => {
    const client = fakeUazapiClient({
      '/chat/find': [{ chats: [{ wa_chatid: '5511999@s.whatsapp.net', wa_lastMsgTimestamp: 1_700_001_000_000 }] }],
      '/message/find': [
        {
          messages: [
            {
              messageid: 'MSG1',
              messageTimestamp: 1_700_001_000_000,
              messageType: 'conversation',
              sender_pn: '5511999999999@s.whatsapp.net',
              senderName: 'Fulana',
              text: 'oi, perdida na queda',
            },
          ],
        },
      ],
    });
    const { db, ingestInboundMessage, inserted } = fakeDb();

    const result = await recoverMessages(
      db,
      client,
      fakeProvider(),
      CHANNEL,
      WINDOW,
      { ingestInboundMessage },
    );

    expect(result.inserted).toBe(1);
    expect(result.alreadyExisted).toBe(0);
    expect(inserted[0]).toMatchObject({
      providerMessageId: 'MSG1',
      suppressEngines: true,
      content: { type: 'text', text: 'oi, perdida na queda' },
    });
  });

  it('pula (already_existed) mensagem cujo message_id já está no banco — idempotência', async () => {
    const client = fakeUazapiClient({
      '/chat/find': [{ chats: [{ wa_chatid: 'a@s.whatsapp.net', wa_lastMsgTimestamp: 1_700_001_000_000 }] }],
      '/message/find': [
        {
          messages: [
            {
              messageid: 'MSG_JA_EXISTE',
              messageTimestamp: 1_700_001_000_000,
              messageType: 'conversation',
              sender_pn: '5511999999999@s.whatsapp.net',
              text: 'oi',
            },
          ],
        },
      ],
    });
    const { db, ingestInboundMessage } = fakeDb(['MSG_JA_EXISTE']);

    const result = await recoverMessages(db, client, fakeProvider(), CHANNEL, WINDOW, {
      ingestInboundMessage,
    });

    expect(result.alreadyExisted).toBe(1);
    expect(result.inserted).toBe(0);
    expect(ingestInboundMessage).not.toHaveBeenCalled();
  });

  it('resolve mídia via provider.resolveInboundMediaUrl e grava a URL do storage', async () => {
    const client = fakeUazapiClient({
      '/chat/find': [{ chats: [{ wa_chatid: 'a@s.whatsapp.net', wa_lastMsgTimestamp: 1_700_001_000_000 }] }],
      '/message/find': [
        {
          messages: [
            {
              messageid: 'MSG_IMG',
              messageTimestamp: 1_700_001_000_000,
              messageType: 'imageMessage',
              sender_pn: '5511999999999@s.whatsapp.net',
              content: { URL: 'https://cdn/encrypted.enc', mediaKey: 'abc123', mimetype: 'image/jpeg' },
            },
          ],
        },
      ],
    });
    const { db, ingestInboundMessage, inserted } = fakeDb();
    const resolveInboundMediaUrl = vi.fn(async () => 'https://storage/imagem.jpg');

    await recoverMessages(db, client, fakeProvider(resolveInboundMediaUrl), CHANNEL, WINDOW, {
      ingestInboundMessage,
    });

    expect(resolveInboundMediaUrl).toHaveBeenCalledTimes(1);
    expect(inserted[0].content).toMatchObject({ mediaUrl: 'https://storage/imagem.jpg' });
  });

  it('mídia que falha ao resolver (link expirado) degrada pra mensagem sem mídia, não derruba a recuperação', async () => {
    const client = fakeUazapiClient({
      '/chat/find': [{ chats: [{ wa_chatid: 'a@s.whatsapp.net', wa_lastMsgTimestamp: 1_700_001_000_000 }] }],
      '/message/find': [
        {
          messages: [
            {
              messageid: 'MSG_IMG_EXPIRADA',
              messageTimestamp: 1_700_001_000_000,
              messageType: 'imageMessage',
              sender_pn: '5511999999999@s.whatsapp.net',
              content: { URL: 'https://cdn/encrypted.enc', mediaKey: 'abc123', mimetype: 'image/jpeg' },
            },
          ],
        },
      ],
    });
    const { db, ingestInboundMessage, inserted } = fakeDb();
    const resolveInboundMediaUrl = vi.fn(async () => {
      throw new Error('link expirado');
    });

    const result = await recoverMessages(db, client, fakeProvider(resolveInboundMediaUrl), CHANNEL, WINDOW, {
      ingestInboundMessage,
    });

    expect(result.inserted).toBe(1);
    expect(inserted[0].content).toMatchObject({ mediaUrl: undefined });
  });

  it('erro ao gravar uma mensagem não interrompe as demais — soma em `errors` e segue', async () => {
    const client = fakeUazapiClient({
      '/chat/find': [{ chats: [{ wa_chatid: 'a@s.whatsapp.net', wa_lastMsgTimestamp: 1_700_001_000_000 }] }],
      '/message/find': [
        {
          messages: [
            { messageid: 'MSG_ERRO', messageTimestamp: 1_700_001_000_000, messageType: 'conversation', sender_pn: '5511999999999@s.whatsapp.net', text: 'vai falhar' },
            { messageid: 'MSG_OK', messageTimestamp: 1_700_000_900_000, messageType: 'conversation', sender_pn: '5511999999999@s.whatsapp.net', text: 'vai funcionar' },
          ],
        },
      ],
    });
    const { db } = fakeDb();
    let call = 0;
    const ingestInboundMessage = vi.fn(async () => {
      call++;
      if (call === 1) throw new Error('falha de banco simulada');
      return { messageId: 'msg-2', conversationId: 'conv-1', contactId: 'ct-1', deduped: false };
    });

    const result = await recoverMessages(db, client, fakeProvider(), CHANNEL, WINDOW, {
      ingestInboundMessage,
    });

    expect(result.errors).toBe(1);
    expect(result.inserted).toBe(1);
    expect(ingestInboundMessage).toHaveBeenCalledTimes(2);
  });

  it('respeita onlyChatid/onlyIsGroup — rodar num lote pequeno antes da conta inteira', async () => {
    const client = fakeUazapiClient({
      '/message/find': [
        {
          messages: [
            { messageid: 'MSG_SO_DESTE_CHAT', messageTimestamp: 1_700_001_000_000, messageType: 'conversation', sender_pn: '5511999999999@s.whatsapp.net', text: 'oi' },
          ],
        },
      ],
    });
    const { db, ingestInboundMessage } = fakeDb();

    const result = await recoverMessages(db, client, fakeProvider(), CHANNEL, WINDOW, {
      onlyChatid: 'so-este@s.whatsapp.net',
      ingestInboundMessage,
    });

    expect(result.inserted).toBe(1);
    // nunca chamou /chat/find — prova que pulou a listagem geral.
    expect(client.post).toHaveBeenCalledTimes(1);
  });
});

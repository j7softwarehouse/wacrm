import { describe, expect, it, vi } from 'vitest';

import { previewRecovery, type ReadOnlyUazapiClient } from './recovery-preview';

// Valores realistas de epoch em milissegundos (> 1e12) — abaixo disso
// a heurística de `toMs` os reinterpreta como segundos (ver teste de
// normalização mais abaixo, que testa exatamente essa heurística).
const WINDOW = { sinceMs: 1_700_000_000_000, untilMs: 1_700_003_600_000 };

function fakeClient(handlers: Record<string, unknown[]>): ReadOnlyUazapiClient & { post: ReturnType<typeof vi.fn> } {
  const calls: Record<string, number> = {};
  const post = vi.fn(async (path: string) => {
    const i = calls[path] ?? 0;
    calls[path] = i + 1;
    const seq = handlers[path];
    if (!seq) throw new Error(`sem resposta programada para ${path}`);
    return seq[Math.min(i, seq.length - 1)];
  });
  return { post } as unknown as ReadOnlyUazapiClient & { post: ReturnType<typeof vi.fn> };
}

describe('previewRecovery', () => {
  it('ignora chats cujo wa_lastMsgTimestamp é anterior à janela (nenhuma mensagem recuperável)', async () => {
    const client = fakeClient({
      '/chat/find': [{ chats: [{ wa_chatid: 'a@g.us', wa_isGroup: true, wa_lastMsgTimestamp: 1_699_999_000_000 }] }],
    });
    const result = await previewRecovery(client, WINDOW);
    expect(result.byChat).toEqual([]);
    expect(result.totalMessages).toBe(0);
    expect(client.post).toHaveBeenCalledTimes(1); // nunca chamou /message/find
  });

  it('coleta mensagens dentro da janela de um chat e para ao ver uma mais antiga', async () => {
    const client = fakeClient({
      '/chat/find': [{ chats: [{ wa_chatid: '5511999@s.whatsapp.net', wa_isGroup: false, wa_lastMsgTimestamp: 1_700_001_000_000 }] }],
      '/message/find': [
        {
          messages: [
            { messageid: 'MSG3', messageTimestamp: 1_700_002_000_000 },
            { messageid: 'MSG2', messageTimestamp: 1_700_001_000_000 },
            { messageid: 'MSG1', messageTimestamp: 1_699_999_000_000 }, // fora da janela — mais antiga
          ],
        },
      ],
    });
    const result = await previewRecovery(client, WINDOW);
    expect(result.byChat).toEqual([
      { chatid: '5511999@s.whatsapp.net', isGroup: false, count: 2, messageIds: ['MSG3', 'MSG2'] },
    ]);
    expect(result.totalMessages).toBe(2);
  });

  it('exclui mensagens com wasSentByApi (eco do próprio envio pelo CRM)', async () => {
    const client = fakeClient({
      '/chat/find': [{ chats: [{ wa_chatid: 'a@s.whatsapp.net', wa_lastMsgTimestamp: 1_700_001_000_000 }] }],
      '/message/find': [
        {
          messages: [
            { messageid: 'MSG_API', messageTimestamp: 1_700_001_000_000, wasSentByApi: true },
            { messageid: 'MSG_REAL', messageTimestamp: 1_700_000_500_000, wasSentByApi: false },
          ],
        },
      ],
    });
    const result = await previewRecovery(client, WINDOW);
    expect(result.byChat[0]?.messageIds).toEqual(['MSG_REAL']);
  });

  it('normaliza timestamp de chat/mensagem em segundos (uazapi pode mandar nos dois formatos)', async () => {
    // 1_700_001_000 segundos = 1_700_001_000_000 ms — dentro de WINDOW.
    const client = fakeClient({
      '/chat/find': [{ chats: [{ wa_chatid: 'a@s.whatsapp.net', wa_lastMsgTimestamp: 1_700_001_000 }] }],
      '/message/find': [{ messages: [{ messageid: 'MSG1', messageTimestamp: 1_700_001_000 }] }],
    });
    const result = await previewRecovery(client, WINDOW);
    expect(result.byChat[0]?.count).toBe(1);
  });

  it('pagina /chat/find até achar uma página mais curta que o limite', async () => {
    const page1 = { chats: Array.from({ length: 50 }, (_, i) => ({ wa_chatid: `c${i}`, wa_lastMsgTimestamp: 1_700_001_000_000 })) };
    const page2 = { chats: [{ wa_chatid: 'last@s.whatsapp.net', wa_lastMsgTimestamp: 1_700_001_000_000 }] };
    const client = fakeClient({
      '/chat/find': [page1, page2],
      '/message/find': [{ messages: [] }],
    });
    const result = await previewRecovery(client, WINDOW);
    expect(result.chatsScanned).toBe(51);
  });
});

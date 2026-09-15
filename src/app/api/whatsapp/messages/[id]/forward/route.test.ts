import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  sendMessageToConversation: vi.fn(),
  // Preenchido pelo fake de `messages.update()` -- não passa por
  // `comSessao()` porque os testes já existentes chamam `comSessao()`
  // como o cliente inteiro, sem embrulho; um array hoisted evita
  // reescrever todas as chamadas só pra capturar isso.
  messageUpdates: [] as { id: string; patch: Record<string, unknown> }[],
}));

vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));
vi.mock('@/lib/whatsapp/send-message', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/whatsapp/send-message')>();
  return { ...actual, sendMessageToConversation: mocks.sendMessageToConversation };
});

import { POST } from './route';

const ACCOUNT = 'acct-1';

/**
 * Cliente com sessão em `acct-1`. `message` é a mensagem de origem;
 * `sourceChannelId` é o canal (bruto, pode ser null) da conversa de
 * origem; `channels` são as linhas de `whatsapp_channels` da conta
 * (id + phone_e164, JÁ na ordem de criação — o primeiro item é o
 * "canal padrão" que `resolveDefaultChannelId` devolveria);
 * `destinations` são as conversas candidatas a destino, cada uma com
 * seu próprio `channel_id` (bruto, pode ser null).
 */
function comSessao(options: {
  message?: Record<string, unknown> | null;
  sourceConversationFound?: boolean;
  sourceChannelId?: string | null;
  channels?: { id: string; phone_e164: string | null }[];
  destinations?: { id: string; channel_id: string | null }[];
} = {}) {
  const {
    message = {
      id: 'msg-1',
      conversation_id: 'conv-origem',
      content_type: 'text',
      content_text: 'bom dia',
      media_url: null,
      deleted_at: null,
    },
    sourceConversationFound = true,
    sourceChannelId = 'chan-1',
    channels = [{ id: 'chan-1', phone_e164: '553183886076' }],
    destinations = [
      { id: 'conv-a', channel_id: 'chan-1' },
      { id: 'conv-b', channel_id: 'chan-1' },
    ],
  } = options;

  return {
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }) },
    from: (table: string) => {
      if (table === 'profiles') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { account_id: ACCOUNT },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'messages') {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: message, error: null }) }),
          }),
          update: (patch: Record<string, unknown>) => ({
            eq: async (_col: string, id: string) => {
              mocks.messageUpdates.push({ id, patch });
              return { data: null, error: null };
            },
          }),
        };
      }
      if (table === 'whatsapp_channels') {
        // Atende dois formatos de chamada sobre a MESMA tabela:
        // resolveDefaultChannelId() (.select('id').eq().order().limit()
        // .maybeSingle(), devolve só o primeiro canal) e a consulta
        // própria da rota (.select('id, phone_e164').eq(), resolvida
        // direto como array quando dá `await` na cadeia sem mais nada).
        const chain: PromiseLike<{ data: typeof channels; error: null }> & {
          select: () => typeof chain;
          eq: () => typeof chain;
          order: () => typeof chain;
          limit: () => typeof chain;
          maybeSingle: () => Promise<{ data: unknown; error: null }>;
        } = {
          select: () => chain,
          eq: () => chain,
          order: () => chain,
          limit: () => chain,
          maybeSingle: async () => ({ data: channels[0] ?? null, error: null }),
          then: (resolve) =>
            Promise.resolve({ data: channels, error: null }).then(resolve as never),
        };
        return chain;
      }
      // conversations — usada tanto para checar a origem (termina em
      // .maybeSingle()) quanto os destinos (termina resolvendo direto
      // via `then`, sem `.in()` explícito — a rota busca todos os
      // candidatos da conta e filtra por telefone em código).
      const filters = new Map<string, unknown>();
      const chain: PromiseLike<{ data: typeof destinations; error: null }> & {
        select: () => typeof chain;
        eq: (col: string, val: unknown) => typeof chain;
        is: (col: string, val: unknown) => typeof chain;
        maybeSingle: () => Promise<{ data: unknown; error: null }>;
        in: (col: string, ids: string[]) => Promise<{ data: unknown; error: null }>;
      } = {
        select: () => chain,
        eq: (col: string, val: unknown) => {
          filters.set(col, val);
          return chain;
        },
        is: (col: string, val: unknown) => {
          filters.set(col, val);
          return chain;
        },
        maybeSingle: async () => ({
          data: sourceConversationFound
            ? { id: 'conv-origem', channel_id: sourceChannelId }
            : null,
          error: null,
        }),
        in: async (_col: string, ids: string[]) => ({
          data: destinations.filter((d) => ids.includes(d.id)),
          error: null,
        }),
        then: (resolve) =>
          Promise.resolve({ data: destinations, error: null }).then(resolve as never),
      };
      return chain;
    },
  };
}

function request(body: Record<string, unknown>) {
  return new Request('https://x/api/whatsapp/messages/msg-1/forward', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

const params = Promise.resolve({ id: 'msg-1' });

describe('POST /api/whatsapp/messages/[id]/forward', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.messageUpdates.length = 0;
    mocks.sendMessageToConversation.mockResolvedValue({
      messageId: 'm-novo',
      whatsappMessageId: 'WA1',
    });
  });

  it('devolve 401 sem sessao', async () => {
    mocks.createClient.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    });

    const res = await POST(request({ conversationIds: ['conv-a'] }), { params });

    expect(res.status).toBe(401);
  });

  it('devolve 400 sem nenhum destino', async () => {
    mocks.createClient.mockResolvedValue(comSessao());

    const res = await POST(request({ conversationIds: [] }), { params });

    expect(res.status).toBe(400);
    expect(mocks.sendMessageToConversation).not.toHaveBeenCalled();
  });

  it('devolve 400 acima do limite de 5 destinos', async () => {
    mocks.createClient.mockResolvedValue(comSessao());

    const res = await POST(
      request({ conversationIds: ['a', 'b', 'c', 'd', 'e', 'f'] }),
      { params },
    );

    expect(res.status).toBe(400);
    expect(mocks.sendMessageToConversation).not.toHaveBeenCalled();
  });

  it('devolve 404 quando a mensagem de origem e de outra conta', async () => {
    mocks.createClient.mockResolvedValue(comSessao({ sourceConversationFound: false }));

    const res = await POST(request({ conversationIds: ['conv-a'] }), { params });

    expect(res.status).toBe(404);
    expect(mocks.sendMessageToConversation).not.toHaveBeenCalled();
  });

  it('devolve 400 ao encaminhar mensagem apagada', async () => {
    mocks.createClient.mockResolvedValue(
      comSessao({
        message: {
          id: 'msg-1',
          conversation_id: 'conv-origem',
          content_type: 'text',
          content_text: 'oi',
          media_url: null,
          deleted_at: '2026-09-14T10:00:00Z',
        },
      }),
    );

    const res = await POST(request({ conversationIds: ['conv-a'] }), { params });

    expect(res.status).toBe(400);
    expect(mocks.sendMessageToConversation).not.toHaveBeenCalled();
  });

  it('devolve 400 ao encaminhar video cuja midia ja expirou (media_url nulo)', async () => {
    mocks.createClient.mockResolvedValue(
      comSessao({
        message: {
          id: 'msg-1',
          conversation_id: 'conv-origem',
          content_type: 'video',
          content_text: null,
          media_url: null,
          deleted_at: null,
        },
      }),
    );

    const res = await POST(request({ conversationIds: ['conv-a'] }), { params });
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/no longer available/i);
    expect(mocks.sendMessageToConversation).not.toHaveBeenCalled();
  });

  it('devolve 400 quando um destino nao pertence a conta', async () => {
    mocks.createClient.mockResolvedValue(
      comSessao({ destinations: [{ id: 'conv-a', channel_id: 'chan-1' }] }),
    );

    const res = await POST(
      request({ conversationIds: ['conv-a', 'conv-de-outra-conta'] }),
      { params },
    );

    expect(res.status).toBe(400);
    expect(mocks.sendMessageToConversation).not.toHaveBeenCalled();
  });

  it('devolve 400 quando um destino e de OUTRO NUMERO, mesmo pertencendo a mesma conta', async () => {
    // Encaminhar precisa ficar dentro do mesmo NUMERO — dois canais com
    // telefones diferentes da mesma conta se comportam como duas contas
    // de WhatsApp independentes.
    mocks.createClient.mockResolvedValue(
      comSessao({
        sourceChannelId: 'chan-1',
        channels: [
          { id: 'chan-1', phone_e164: '553183886076' },
          { id: 'chan-2', phone_e164: '553183839660' },
        ],
        destinations: [
          { id: 'conv-a', channel_id: 'chan-1' },
          { id: 'conv-b', channel_id: 'chan-2' },
        ],
      }),
    );

    const res = await POST(
      request({ conversationIds: ['conv-a', 'conv-b'] }),
      { params },
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/not found/i);
    expect(mocks.sendMessageToConversation).not.toHaveBeenCalled();
  });

  it('permite destino em canal com id DIFERENTE mas MESMO numero (instancia UAZAPI recriada)', async () => {
    // O caso real que motivou a correção: a origem ficou orfã
    // (channel_id nulo) quando o canal antigo foi apagado, mas o canal
    // padrão atual da conta tem o MESMO telefone de quando essa
    // conversa foi criada -- não pode ser tratado como conta diferente.
    mocks.createClient.mockResolvedValue(
      comSessao({
        sourceChannelId: null,
        channels: [{ id: 'chan-novo', phone_e164: '553183886076' }],
        destinations: [{ id: 'conv-a', channel_id: 'chan-novo' }],
      }),
    );

    const res = await POST(request({ conversationIds: ['conv-a'] }), { params });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.sent).toBe(1);
  });

  it('encaminha para cada destino do MESMO numero marcando forwarded: true', async () => {
    mocks.createClient.mockResolvedValue(comSessao());

    const res = await POST(
      request({ conversationIds: ['conv-a', 'conv-b'] }),
      { params },
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.sent).toBe(2);
    expect(mocks.sendMessageToConversation).toHaveBeenCalledTimes(2);
    const firstCall = mocks.sendMessageToConversation.mock.calls[0][2];
    expect(firstCall).toMatchObject({
      conversationId: 'conv-a',
      messageType: 'text',
      contentText: 'bom dia',
      forwarded: true,
    });
  });

  it('para de vez quando o provedor recusa por limite, sem tentar os proximos', async () => {
    mocks.createClient.mockResolvedValue(
      comSessao({
        destinations: [
          { id: 'conv-a', channel_id: 'chan-1' },
          { id: 'conv-b', channel_id: 'chan-1' },
          { id: 'conv-c', channel_id: 'chan-1' },
        ],
      }),
    );
    const { ProviderRateLimitError } = await import('@/lib/whatsapp/providers/types');
    mocks.sendMessageToConversation.mockRejectedValueOnce(
      new ProviderRateLimitError('uazapi', { providerMessage: 'limite atingido' }),
    );

    const res = await POST(
      request({ conversationIds: ['conv-a', 'conv-b', 'conv-c'] }),
      { params },
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.sent).toBe(0);
    // Só a PRIMEIRA tentativa acontece — as outras duas nem chegam a
    // ser enviadas, exatamente o ponto de não queimar o número.
    expect(mocks.sendMessageToConversation).toHaveBeenCalledTimes(1);
    expect(json.results[1].error).toMatch(/rate limit/i);
    expect(json.results[2].error).toMatch(/rate limit/i);
  });

  it('uma falha comum num destino nao impede os demais', async () => {
    mocks.createClient.mockResolvedValue(comSessao());
    mocks.sendMessageToConversation.mockRejectedValueOnce(new Error('canal caiu'));

    const res = await POST(
      request({ conversationIds: ['conv-a', 'conv-b'] }),
      { params },
    );
    const json = await res.json();

    expect(json.sent).toBe(1);
    expect(mocks.sendMessageToConversation).toHaveBeenCalledTimes(2);
    expect(json.results[0].ok).toBe(false);
    expect(json.results[1].ok).toBe(true);
  });

  it('junta a nota no MESMO balao do texto encaminhado, separada por linha em branco', async () => {
    // Pedido do usuario apos ver dois baloes separados na pratica --
    // "gera confusao". Um encaminhamento de texto vira UMA chamada so,
    // com a nota anexada ao final do conteudo original.
    mocks.createClient.mockResolvedValue(comSessao());

    const res = await POST(
      request({ conversationIds: ['conv-a'], note: 'Olha isso aí' }),
      { params },
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.sent).toBe(1);
    expect(mocks.sendMessageToConversation).toHaveBeenCalledTimes(1);
    const call = mocks.sendMessageToConversation.mock.calls[0][2];
    expect(call).toMatchObject({
      conversationId: 'conv-a',
      forwarded: true,
      contentText: 'bom dia\n\nOlha isso aí',
    });
    // Grava a nota separada também -- é o que deixa a bolha do CRM
    // saber onde o trecho digitado começa dentro do content_text.
    expect(mocks.messageUpdates).toEqual([
      { id: 'm-novo', patch: { forwarded_note: 'Olha isso aí' } },
    ]);
  });

  it('junta a nota como legenda quando a mensagem original e midia (imagem/video/documento)', async () => {
    mocks.createClient.mockResolvedValue(
      comSessao({
        message: {
          id: 'msg-1',
          conversation_id: 'conv-origem',
          content_type: 'image',
          content_text: null,
          media_url: 'https://x/foto.jpg',
          deleted_at: null,
        },
      }),
    );

    const res = await POST(
      request({ conversationIds: ['conv-a'], note: 'segue a foto' }),
      { params },
    );

    expect(res.status).toBe(200);
    expect(mocks.sendMessageToConversation).toHaveBeenCalledTimes(1);
    const call = mocks.sendMessageToConversation.mock.calls[0][2];
    expect(call).toMatchObject({
      messageType: 'image',
      contentText: 'segue a foto',
      forwarded: true,
    });
  });

  it('AUDIO continua em dois baloes -- WhatsApp recusa legenda em audio', async () => {
    mocks.createClient.mockResolvedValue(
      comSessao({
        message: {
          id: 'msg-1',
          conversation_id: 'conv-origem',
          content_type: 'audio',
          content_text: null,
          media_url: 'https://x/audio.ogg',
          deleted_at: null,
        },
      }),
    );

    const res = await POST(
      request({ conversationIds: ['conv-a'], note: 'ouve isso' }),
      { params },
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.sent).toBe(1);
    expect(mocks.sendMessageToConversation).toHaveBeenCalledTimes(2);
    const [forwardCall, noteCall] = mocks.sendMessageToConversation.mock.calls.map(
      (c) => c[2],
    );
    expect(forwardCall).toMatchObject({ messageType: 'audio', forwarded: true });
    expect(forwardCall.contentText).toBeNull();
    expect(noteCall).toMatchObject({ messageType: 'text', contentText: 'ouve isso' });
    expect(noteCall.forwarded).toBeFalsy();
    // Em áudio a nota NUNCA foi anexada ao content_text encaminhado --
    // não há o que gravar em forwarded_note pra essa mensagem.
    expect(mocks.messageUpdates).toEqual([]);
  });

  it('nao muda o conteudo quando o campo nota vem vazio ou so espaco', async () => {
    mocks.createClient.mockResolvedValue(comSessao());

    await POST(request({ conversationIds: ['conv-a'], note: '   ' }), { params });

    expect(mocks.sendMessageToConversation).toHaveBeenCalledTimes(1);
    expect(mocks.sendMessageToConversation.mock.calls[0][2]).toMatchObject({
      contentText: 'bom dia',
    });
  });

  it('em audio, nao tenta mandar a nota quando o proprio encaminhamento ja falhou', async () => {
    mocks.createClient.mockResolvedValue(
      comSessao({
        message: {
          id: 'msg-1',
          conversation_id: 'conv-origem',
          content_type: 'audio',
          content_text: null,
          media_url: 'https://x/audio.ogg',
          deleted_at: null,
        },
      }),
    );
    mocks.sendMessageToConversation.mockRejectedValueOnce(new Error('canal caiu'));

    await POST(request({ conversationIds: ['conv-a'], note: 'oi' }), { params });

    // Só a tentativa do encaminhamento -- a nota nunca chega a ser
    // tentada pra um destino que já falhou.
    expect(mocks.sendMessageToConversation).toHaveBeenCalledTimes(1);
  });

  it('em audio, se a nota falhar depois do encaminhamento ok, o destino conta como falho', async () => {
    mocks.createClient.mockResolvedValue(
      comSessao({
        message: {
          id: 'msg-1',
          conversation_id: 'conv-origem',
          content_type: 'audio',
          content_text: null,
          media_url: 'https://x/audio.ogg',
          deleted_at: null,
        },
      }),
    );
    mocks.sendMessageToConversation
      .mockResolvedValueOnce({ messageId: 'm1', whatsappMessageId: 'WA1' }) // encaminhado ok
      .mockRejectedValueOnce(new Error('nota falhou')); // nota falha

    const res = await POST(
      request({ conversationIds: ['conv-a'], note: 'segue o link' }),
      { params },
    );
    const json = await res.json();

    expect(json.sent).toBe(0);
    expect(json.results[0].ok).toBe(false);
    expect(json.results[0].error).toMatch(/nota falhou/i);
  });

  it('rate limit na nota de AUDIO para os proximos destinos, igual ao encaminhamento', async () => {
    mocks.createClient.mockResolvedValue(
      comSessao({
        message: {
          id: 'msg-1',
          conversation_id: 'conv-origem',
          content_type: 'audio',
          content_text: null,
          media_url: 'https://x/audio.ogg',
          deleted_at: null,
        },
        destinations: [
          { id: 'conv-a', channel_id: 'chan-1' },
          { id: 'conv-b', channel_id: 'chan-1' },
        ],
      }),
    );
    const { ProviderRateLimitError } = await import('@/lib/whatsapp/providers/types');
    mocks.sendMessageToConversation
      .mockResolvedValueOnce({ messageId: 'm1', whatsappMessageId: 'WA1' }) // encaminhado conv-a ok
      .mockRejectedValueOnce(
        new ProviderRateLimitError('uazapi', { providerMessage: 'limite atingido' }),
      ); // nota conv-a bate no limite

    const res = await POST(
      request({ conversationIds: ['conv-a', 'conv-b'], note: 'oi' }),
      { params },
    );
    const json = await res.json();

    expect(json.sent).toBe(0);
    // conv-b nem chega a ter o encaminhamento tentado.
    expect(mocks.sendMessageToConversation).toHaveBeenCalledTimes(2);
    expect(json.results[1].error).toMatch(/rate limit/i);
  });
});

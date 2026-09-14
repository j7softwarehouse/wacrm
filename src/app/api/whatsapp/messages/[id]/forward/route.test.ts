import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  sendMessageToConversation: vi.fn(),
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
 * `destinationIds` são as conversas que a consulta de destino devolve
 * (o que NÃO estiver aqui conta como "de outra conta").
 */
function comSessao(options: {
  message?: Record<string, unknown> | null;
  sourceConversationFound?: boolean;
  destinationIds?: string[];
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
    destinationIds = ['conv-a', 'conv-b'],
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
        };
      }
      // conversations — serve tanto a checagem da origem (.eq.eq.maybeSingle)
      // quanto a dos destinos (.eq.in)
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: sourceConversationFound ? { id: 'conv-origem' } : null,
                error: null,
              }),
            }),
            in: async (_col: string, ids: string[]) => ({
              data: ids
                .filter((i) => destinationIds.includes(i))
                .map((id) => ({ id })),
              error: null,
            }),
          }),
        }),
      };
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
      comSessao({ destinationIds: ['conv-a'] }),
    );

    const res = await POST(
      request({ conversationIds: ['conv-a', 'conv-de-outra-conta'] }),
      { params },
    );

    expect(res.status).toBe(400);
    expect(mocks.sendMessageToConversation).not.toHaveBeenCalled();
  });

  it('encaminha para cada destino marcando forwarded: true', async () => {
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
      comSessao({ destinationIds: ['conv-a', 'conv-b', 'conv-c'] }),
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
});

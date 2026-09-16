import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getProviderForConversation: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));
vi.mock('@/lib/whatsapp/providers/resolve', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/whatsapp/providers/resolve')>();
  return { ...actual, getProviderForConversation: mocks.getProviderForConversation };
});

import { POST } from './route';
import { ProviderError } from '@/lib/whatsapp/providers/types';

// Simula profiles + messages + conversations respeitando de fato os
// `.eq(coluna, valor)` encadeados (AND), igual ao padrão já usado em
// groups/[id]/leave/route.test.ts — assim um teste com mensagem/conversa
// de OUTRA conta só "acha" a linha se a rota não filtrar por account_id,
// expondo falta de isolamento.
function comSessao(opts: {
  userId?: string;
  role: string;
  mensagem: Record<string, unknown> | null;
  conversa?: Record<string, unknown> | null;
  updateSpy?: (payload: unknown) => void;
}) {
  const { userId = 'user-1', role, mensagem, conversa, updateSpy } = opts;
  return {
    auth: { getUser: async () => ({ data: { user: { id: userId } }, error: null }) },
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
      if (table === 'messages') {
        const filtros: Record<string, unknown> = {};
        const chain = {
          select: () => chain,
          eq: (coluna: string, valor: unknown) => {
            filtros[coluna] = valor;
            return chain;
          },
          maybeSingle: async () => {
            if (!mensagem) return { data: null, error: null };
            const bate = Object.entries(filtros).every(
              ([coluna, valor]) => mensagem[coluna] === valor,
            );
            return { data: bate ? mensagem : null, error: null };
          },
          update: (payload: unknown) => {
            updateSpy?.(payload);
            return {
              eq: () => ({
                select: () => ({
                  single: async () => ({
                    data: { ...mensagem, ...(payload as object) },
                    error: null,
                  }),
                }),
              }),
            };
          },
        };
        return chain;
      }
      // conversations
      const filtrosConv: Record<string, unknown> = {};
      const chainConv = {
        select: () => chainConv,
        eq: (coluna: string, valor: unknown) => {
          filtrosConv[coluna] = valor;
          return chainConv;
        },
        maybeSingle: async () => {
          if (!conversa) return { data: null, error: null };
          const bate = Object.entries(filtrosConv).every(
            ([coluna, valor]) => conversa[coluna] === valor,
          );
          return { data: bate ? conversa : null, error: null };
        },
      };
      return chainConv;
    },
  };
}

function request(body: unknown) {
  return new Request('https://x/api/whatsapp/messages/m-1/edit', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}
const params = Promise.resolve({ id: 'm-1' });

const MSG_BASE = {
  id: 'm-1',
  conversation_id: 'conv-1',
  sender_type: 'agent',
  sender_id: 'user-1',
  content_type: 'text',
  content_text: 'texto antigo',
  message_id: 'WAMID-1',
  deleted_at: null,
  original_content_text: null,
};
const CONV_UAZAPI = { id: 'conv-1', account_id: 'acct-1', channel_id: 'chan-1' };

describe('POST /api/whatsapp/messages/[id]/edit', () => {
  beforeEach(() => vi.clearAllMocks());

  it('devolve 401 sem sessao', async () => {
    mocks.createClient.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    });
    const res = await POST(request({ text: 'novo' }), { params });
    expect(res.status).toBe(401);
  });

  it('devolve 404 quando a mensagem nao existe', async () => {
    mocks.createClient.mockResolvedValue(
      comSessao({ role: 'agent', mensagem: null }),
    );
    const res = await POST(request({ text: 'novo' }), { params });
    expect(res.status).toBe(404);
  });

  it('devolve 400 quando a mensagem e do cliente', async () => {
    mocks.createClient.mockResolvedValue(
      comSessao({
        role: 'agent',
        mensagem: { ...MSG_BASE, sender_type: 'customer' },
      }),
    );
    const res = await POST(request({ text: 'novo' }), { params });
    expect(res.status).toBe(400);
  });

  it('devolve 400 quando content_type nao e text', async () => {
    mocks.createClient.mockResolvedValue(
      comSessao({
        role: 'agent',
        mensagem: { ...MSG_BASE, content_type: 'image' },
      }),
    );
    const res = await POST(request({ text: 'novo' }), { params });
    expect(res.status).toBe(400);
  });

  it('devolve 400 quando a mensagem ja foi apagada', async () => {
    mocks.createClient.mockResolvedValue(
      comSessao({
        role: 'agent',
        mensagem: { ...MSG_BASE, deleted_at: '2026-09-10T00:00:00Z' },
      }),
    );
    const res = await POST(request({ text: 'novo' }), { params });
    expect(res.status).toBe(400);
  });

  it('devolve 400 quando a mensagem nao tem message_id (nao chegou a sair)', async () => {
    mocks.createClient.mockResolvedValue(
      comSessao({
        role: 'agent',
        mensagem: { ...MSG_BASE, message_id: null },
      }),
    );
    const res = await POST(request({ text: 'novo' }), { params });
    expect(res.status).toBe(400);
  });

  it('devolve 403 quando quem chama nao e o autor nem admin', async () => {
    mocks.createClient.mockResolvedValue(
      comSessao({ userId: 'user-2', role: 'agent', mensagem: MSG_BASE }),
    );
    const res = await POST(request({ text: 'novo' }), { params });
    expect(res.status).toBe(403);
  });

  it('admin pode editar mensagem de outro agente', async () => {
    mocks.createClient.mockResolvedValue(
      comSessao({
        userId: 'user-2',
        role: 'admin',
        mensagem: MSG_BASE,
        conversa: CONV_UAZAPI,
      }),
    );
    const editMessage = vi.fn(async () => {});
    mocks.getProviderForConversation.mockResolvedValue({ kind: 'uazapi', editMessage });

    const res = await POST(request({ text: 'novo texto' }), { params });
    expect(res.status).toBe(200);
    expect(editMessage).toHaveBeenCalledWith({ messageId: 'WAMID-1', text: 'novo texto' });
  });

  it('devolve 404 quando a conversa nao pertence a conta', async () => {
    mocks.createClient.mockResolvedValue(
      comSessao({
        role: 'agent',
        mensagem: MSG_BASE,
        conversa: { ...CONV_UAZAPI, account_id: 'acct-OUTRA' },
      }),
    );
    const res = await POST(request({ text: 'novo' }), { params });
    expect(res.status).toBe(404);
  });

  it('devolve 502 com a mensagem original quando o provider recusa', async () => {
    mocks.createClient.mockResolvedValue(
      comSessao({ role: 'agent', mensagem: MSG_BASE, conversa: CONV_UAZAPI }),
    );
    const editMessage = vi.fn(async () => {
      throw new ProviderError('uazapi', 'Fora do prazo permitido pelo WhatsApp.');
    });
    mocks.getProviderForConversation.mockResolvedValue({ kind: 'uazapi', editMessage });

    const res = await POST(request({ text: 'novo' }), { params });
    const body = await res.json();
    expect(res.status).toBe(502);
    expect(body.error).toBe('Fora do prazo permitido pelo WhatsApp.');
  });

  it('caminho feliz: chama o provider e grava content_text/edited_at/original_content_text', async () => {
    const updateSpy = vi.fn();
    mocks.createClient.mockResolvedValue(
      comSessao({
        role: 'agent',
        mensagem: MSG_BASE,
        conversa: CONV_UAZAPI,
        updateSpy,
      }),
    );
    const editMessage = vi.fn(async () => {});
    mocks.getProviderForConversation.mockResolvedValue({ kind: 'uazapi', editMessage });

    const res = await POST(request({ text: 'texto novo' }), { params });
    expect(res.status).toBe(200);
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        content_text: 'texto novo',
        original_content_text: 'texto antigo',
      }),
    );
    const payload = updateSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.edited_at).toEqual(expect.any(String));
  });

  it('segunda edicao NAO sobrescreve original_content_text ja preenchido', async () => {
    const updateSpy = vi.fn();
    mocks.createClient.mockResolvedValue(
      comSessao({
        role: 'agent',
        mensagem: { ...MSG_BASE, original_content_text: 'o texto de verdade original' },
        conversa: CONV_UAZAPI,
        updateSpy,
      }),
    );
    const editMessage = vi.fn(async () => {});
    mocks.getProviderForConversation.mockResolvedValue({ kind: 'uazapi', editMessage });

    await POST(request({ text: 'terceira versao' }), { params });
    const payload = updateSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.original_content_text).toBe('o texto de verdade original');
  });
});

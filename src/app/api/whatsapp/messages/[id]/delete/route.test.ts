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
            return { eq: async () => ({ error: null }) };
          },
        };
        return chain;
      }
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

function request() {
  return new Request('https://x/api/whatsapp/messages/m-1/delete', { method: 'POST' });
}
const params = Promise.resolve({ id: 'm-1' });

const MSG_BASE = {
  id: 'm-1',
  conversation_id: 'conv-1',
  sender_type: 'agent',
  sender_id: 'user-1',
  content_type: 'image',
  content_text: 'legenda original',
  message_id: 'WAMID-1',
  deleted_at: null,
};
const CONV_UAZAPI = { id: 'conv-1', account_id: 'acct-1', channel_id: 'chan-1' };

describe('POST /api/whatsapp/messages/[id]/delete', () => {
  beforeEach(() => vi.clearAllMocks());

  it('devolve 401 sem sessao', async () => {
    mocks.createClient.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    });
    const res = await POST(request(), { params });
    expect(res.status).toBe(401);
  });

  it('devolve 404 quando a mensagem nao existe', async () => {
    mocks.createClient.mockResolvedValue(
      comSessao({ role: 'agent', mensagem: null }),
    );
    const res = await POST(request(), { params });
    expect(res.status).toBe(404);
  });

  it('devolve 400 quando a mensagem e do cliente', async () => {
    mocks.createClient.mockResolvedValue(
      comSessao({ role: 'agent', mensagem: { ...MSG_BASE, sender_type: 'customer' } }),
    );
    const res = await POST(request(), { params });
    expect(res.status).toBe(400);
  });

  it('devolve 400 quando ja foi apagada', async () => {
    mocks.createClient.mockResolvedValue(
      comSessao({
        role: 'agent',
        mensagem: { ...MSG_BASE, deleted_at: '2026-09-10T00:00:00Z' },
      }),
    );
    const res = await POST(request(), { params });
    expect(res.status).toBe(400);
  });

  it('devolve 403 quando quem chama nao e o autor nem admin', async () => {
    mocks.createClient.mockResolvedValue(
      comSessao({ userId: 'user-2', role: 'agent', mensagem: MSG_BASE }),
    );
    const res = await POST(request(), { params });
    expect(res.status).toBe(403);
  });

  it('devolve 502 com a mensagem original quando o provider recusa', async () => {
    mocks.createClient.mockResolvedValue(
      comSessao({ role: 'agent', mensagem: MSG_BASE, conversa: CONV_UAZAPI }),
    );
    const deleteMessage = vi.fn(async () => {
      throw new ProviderError('uazapi', 'Mensagem não encontrada na uazapi.');
    });
    mocks.getProviderForConversation.mockResolvedValue({ kind: 'uazapi', deleteMessage });

    const res = await POST(request(), { params });
    const body = await res.json();
    expect(res.status).toBe(502);
    expect(body.error).toBe('Mensagem não encontrada na uazapi.');
  });

  it('caminho feliz: chama o provider e grava deleted_at/deleted_by sem tocar content_text', async () => {
    const updateSpy = vi.fn();
    mocks.createClient.mockResolvedValue(
      comSessao({
        role: 'agent',
        mensagem: MSG_BASE,
        conversa: CONV_UAZAPI,
        updateSpy,
      }),
    );
    const deleteMessage = vi.fn(async () => {});
    mocks.getProviderForConversation.mockResolvedValue({ kind: 'uazapi', deleteMessage });

    const res = await POST(request(), { params });
    expect(res.status).toBe(200);
    expect(deleteMessage).toHaveBeenCalledWith({ messageId: 'WAMID-1' });

    const payload = updateSpy.mock.calls[0][0] as Record<string, unknown>;
    // Garantia real, não só o sintoma: content_text jamais aparece no
    // payload de update — a coluna nunca é tocada.
    expect(payload).not.toHaveProperty('content_text');
    expect(payload.deleted_by).toBe('user-1');
    expect(payload.deleted_at).toEqual(expect.any(String));
  });
});

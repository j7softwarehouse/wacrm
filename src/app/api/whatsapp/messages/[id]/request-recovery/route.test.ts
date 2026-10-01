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
import { ProviderError, ProviderUnsupportedError } from '@/lib/whatsapp/providers/types';

function tabelaSimples(linhas: Record<string, unknown> | null) {
  const filtros: Record<string, unknown> = {};
  const chain = {
    select: () => chain,
    eq: (coluna: string, valor: unknown) => {
      filtros[coluna] = valor;
      return chain;
    },
    maybeSingle: async () => {
      if (!linhas) return { data: null, error: null };
      const bate = Object.entries(filtros).every(([coluna, valor]) => linhas[coluna] === valor);
      return { data: bate ? linhas : null, error: null };
    },
  };
  return chain;
}

function comSessao(opts: {
  userId?: string;
  role: string;
  mensagem: Record<string, unknown> | null;
  conversa?: Record<string, unknown> | null;
  grupo?: Record<string, unknown> | null;
  contato?: Record<string, unknown> | null;
}) {
  const { userId = 'user-1', role, mensagem, conversa, grupo, contato } = opts;
  return {
    auth: { getUser: async () => ({ data: { user: { id: userId } }, error: null }) },
    from: (table: string) => {
      if (table === 'profiles') {
        return tabelaSimples({ user_id: userId, account_id: 'acct-1', account_role: role });
      }
      if (table === 'messages') return tabelaSimples(mensagem);
      if (table === 'conversations') return tabelaSimples(conversa ?? null);
      if (table === 'whatsapp_groups') return tabelaSimples(grupo ?? null);
      if (table === 'contacts') return tabelaSimples(contato ?? null);
      throw new Error(`tabela não simulada: ${table}`);
    },
  };
}

function request() {
  return new Request('https://x/api/whatsapp/messages/m-1/request-recovery', {
    method: 'POST',
  });
}
const params = Promise.resolve({ id: 'm-1' });

const MSG_GRUPO = {
  id: 'm-1',
  conversation_id: 'conv-1',
  sender_type: 'customer',
  message_id: 'ACCC77F755B74CF9ED9C6C78B3031333',
};
const CONV_GRUPO = {
  id: 'conv-1',
  account_id: 'acct-1',
  group_id: 'g-1',
  contact_id: null,
};
const GRUPO = { id: 'g-1', group_jid: '120363429748080632@g.us' };

describe('POST /api/whatsapp/messages/[id]/request-recovery', () => {
  beforeEach(() => vi.clearAllMocks());

  it('devolve 401 sem sessão', async () => {
    mocks.createClient.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    });
    const res = await POST(request(), { params });
    expect(res.status).toBe(401);
  });

  it('devolve 403 pra quem não é admin', async () => {
    mocks.createClient.mockResolvedValue(
      comSessao({ role: 'agent', mensagem: MSG_GRUPO, conversa: CONV_GRUPO, grupo: GRUPO }),
    );
    const res = await POST(request(), { params });
    expect(res.status).toBe(403);
    expect(mocks.getProviderForConversation).not.toHaveBeenCalled();
  });

  it('devolve 404 quando a mensagem não existe (ou é de outra conta)', async () => {
    mocks.createClient.mockResolvedValue(comSessao({ role: 'admin', mensagem: null }));
    const res = await POST(request(), { params });
    expect(res.status).toBe(404);
  });

  it('devolve 400 pra mensagem enviada pelo próprio CRM (agent/bot)', async () => {
    mocks.createClient.mockResolvedValue(
      comSessao({
        role: 'admin',
        mensagem: { ...MSG_GRUPO, sender_type: 'agent' },
      }),
    );
    const res = await POST(request(), { params });
    expect(res.status).toBe(400);
    expect(mocks.getProviderForConversation).not.toHaveBeenCalled();
  });

  it('devolve 400 quando a mensagem não tem message_id (nunca saiu/entrou pelo WhatsApp)', async () => {
    mocks.createClient.mockResolvedValue(
      comSessao({ role: 'admin', mensagem: { ...MSG_GRUPO, message_id: null } }),
    );
    const res = await POST(request(), { params });
    expect(res.status).toBe(400);
  });

  it('devolve 404 quando a conversa é de outra conta', async () => {
    mocks.createClient.mockResolvedValue(
      comSessao({
        role: 'admin',
        mensagem: MSG_GRUPO,
        conversa: { ...CONV_GRUPO, account_id: 'acct-OUTRA' },
      }),
    );
    const res = await POST(request(), { params });
    expect(res.status).toBe(404);
  });

  it('resolve o chatId pelo group_jid quando é conversa de grupo, e chama o provider', async () => {
    mocks.createClient.mockResolvedValue(
      comSessao({ role: 'admin', mensagem: MSG_GRUPO, conversa: CONV_GRUPO, grupo: GRUPO }),
    );
    const requestMessageRecovery = vi.fn(async () => {});
    mocks.getProviderForConversation.mockResolvedValue({ requestMessageRecovery });

    const res = await POST(request(), { params });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.requested).toBe(true);
    expect(requestMessageRecovery).toHaveBeenCalledWith({
      messageId: 'ACCC77F755B74CF9ED9C6C78B3031333',
      chatId: '120363429748080632@g.us',
    });
  });

  it('resolve o chatId pelo telefone do contato quando é conversa 1:1', async () => {
    mocks.createClient.mockResolvedValue(
      comSessao({
        role: 'admin',
        mensagem: MSG_GRUPO,
        conversa: { id: 'conv-1', account_id: 'acct-1', group_id: null, contact_id: 'c-1' },
        contato: { id: 'c-1', phone: '553199999999' },
      }),
    );
    const requestMessageRecovery = vi.fn(async () => {});
    mocks.getProviderForConversation.mockResolvedValue({ requestMessageRecovery });

    const res = await POST(request(), { params });

    expect(res.status).toBe(200);
    expect(requestMessageRecovery).toHaveBeenCalledWith({
      messageId: 'ACCC77F755B74CF9ED9C6C78B3031333',
      chatId: '553199999999',
    });
  });

  it('devolve 400 quando o canal é Meta (provider recusa com ProviderUnsupportedError)', async () => {
    mocks.createClient.mockResolvedValue(
      comSessao({ role: 'admin', mensagem: MSG_GRUPO, conversa: CONV_GRUPO, grupo: GRUPO }),
    );
    mocks.getProviderForConversation.mockResolvedValue({
      requestMessageRecovery: vi.fn(async () => {
        throw new ProviderUnsupportedError('meta', 'requestMessageRecovery');
      }),
    });

    const res = await POST(request(), { params });
    expect(res.status).toBe(400);
  });

  it('devolve 502 quando o provedor recusa por outro motivo', async () => {
    mocks.createClient.mockResolvedValue(
      comSessao({ role: 'admin', mensagem: MSG_GRUPO, conversa: CONV_GRUPO, grupo: GRUPO }),
    );
    mocks.getProviderForConversation.mockResolvedValue({
      requestMessageRecovery: vi.fn(async () => {
        throw new ProviderError('uazapi', 'instância offline');
      }),
    });

    const res = await POST(request(), { params });
    const json = await res.json();
    expect(res.status).toBe(502);
    expect(json.error).toMatch(/offline/i);
  });
});

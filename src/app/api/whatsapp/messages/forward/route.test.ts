import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  sendMessageToConversation: vi.fn(),
  messageUpdates: [] as { id: string; patch: Record<string, unknown> }[],
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/whatsapp/send-message", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/whatsapp/send-message")>();
  return { ...actual, sendMessageToConversation: mocks.sendMessageToConversation };
});

import { __resetRateLimitForTests } from "@/lib/rate-limit";
import { POST } from "./route";

const ACCOUNT = "acct-1";

const MSG_1 = {
  id: "msg-1",
  conversation_id: "conv-origem",
  content_type: "text",
  content_text: "bom dia",
  media_url: null,
  deleted_at: null,
  created_at: "2026-09-26T10:00:00Z",
};
const MSG_2 = {
  id: "msg-2",
  conversation_id: "conv-origem",
  content_type: "text",
  content_text: "tudo bem?",
  media_url: null,
  deleted_at: null,
  created_at: "2026-09-26T10:01:00Z",
};

/**
 * `messages` são as linhas candidatas a encaminhar (já na ordem que o
 * teste quer simular vindo do banco — a rota reordena por created_at
 * de qualquer forma); `channels`/`destinations` seguem o mesmo formato
 * do teste da rota antiga (canal id + telefone; conversas destino com
 * seu próprio channel_id, bruto, pode ser null).
 */
function comSessao(options: {
  messages?: Record<string, unknown>[];
  sourceConversationFound?: boolean;
  sourceChannelId?: string | null;
  channels?: { id: string; phone_e164: string | null }[];
  destinations?: { id: string; channel_id: string | null }[];
} = {}) {
  const {
    messages = [MSG_1],
    sourceConversationFound = true,
    sourceChannelId = "chan-1",
    channels = [{ id: "chan-1", phone_e164: "553183886076" }],
    destinations = [
      { id: "conv-a", channel_id: "chan-1" },
      { id: "conv-b", channel_id: "chan-1" },
    ],
  } = options;

  return {
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }) },
    from: (table: string) => {
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { account_id: ACCOUNT }, error: null }),
            }),
          }),
        };
      }
      if (table === "messages") {
        return {
          select: () => ({
            in: async (_col: string, ids: string[]) => ({
              data: messages.filter((m) => ids.includes(m.id as string)),
              error: null,
            }),
          }),
          update: (patch: Record<string, unknown>) => ({
            eq: async (_col: string, id: string) => {
              mocks.messageUpdates.push({ id, patch });
              return { data: null, error: null };
            },
          }),
        };
      }
      if (table === "whatsapp_channels") {
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
      // conversations
      const filters = new Map<string, unknown>();
      const chain: PromiseLike<{ data: typeof destinations; error: null }> & {
        select: () => typeof chain;
        eq: (col: string, val: unknown) => typeof chain;
        maybeSingle: () => Promise<{ data: unknown; error: null }>;
        in: (col: string, ids: string[]) => Promise<{ data: unknown; error: null }>;
      } = {
        select: () => chain,
        eq: (col: string, val: unknown) => {
          filters.set(col, val);
          return chain;
        },
        maybeSingle: async () => ({
          data: sourceConversationFound
            ? { id: "conv-origem", channel_id: sourceChannelId }
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
  return new Request("https://x/api/whatsapp/messages/forward", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("POST /api/whatsapp/messages/forward", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetRateLimitForTests();
    mocks.messageUpdates.length = 0;
    mocks.sendMessageToConversation.mockResolvedValue({
      messageId: "m-novo",
      whatsappMessageId: "WA1",
    });
  });

  it("devolve 401 sem sessao", async () => {
    mocks.createClient.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    });

    const res = await POST(request({ messageIds: ["msg-1"], conversationIds: ["conv-a"] }));

    expect(res.status).toBe(401);
  });

  it("devolve 400 sem nenhuma mensagem", async () => {
    mocks.createClient.mockResolvedValue(comSessao());

    const res = await POST(request({ messageIds: [], conversationIds: ["conv-a"] }));

    expect(res.status).toBe(400);
    expect(mocks.sendMessageToConversation).not.toHaveBeenCalled();
  });

  it("devolve 400 acima do limite de 5 mensagens", async () => {
    mocks.createClient.mockResolvedValue(comSessao());

    const res = await POST(
      request({
        messageIds: ["1", "2", "3", "4", "5", "6"],
        conversationIds: ["conv-a"],
      }),
    );

    expect(res.status).toBe(400);
    expect(mocks.sendMessageToConversation).not.toHaveBeenCalled();
  });

  it("devolve 400 acima do limite de 5 destinos", async () => {
    mocks.createClient.mockResolvedValue(comSessao());

    const res = await POST(
      request({ messageIds: ["msg-1"], conversationIds: ["a", "b", "c", "d", "e", "f"] }),
    );

    expect(res.status).toBe(400);
    expect(mocks.sendMessageToConversation).not.toHaveBeenCalled();
  });

  it("devolve 404 quando alguma mensagem nao existe (ou e de outra conta)", async () => {
    mocks.createClient.mockResolvedValue(comSessao({ messages: [MSG_1] }));

    const res = await POST(
      request({ messageIds: ["msg-1", "msg-inexistente"], conversationIds: ["conv-a"] }),
    );

    expect(res.status).toBe(404);
    expect(mocks.sendMessageToConversation).not.toHaveBeenCalled();
  });

  it("devolve 400 quando as mensagens selecionadas sao de conversas diferentes", async () => {
    mocks.createClient.mockResolvedValue(
      comSessao({ messages: [MSG_1, { ...MSG_2, conversation_id: "conv-OUTRA" }] }),
    );

    const res = await POST(
      request({ messageIds: ["msg-1", "msg-2"], conversationIds: ["conv-a"] }),
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.error).toMatch(/same conversation/i);
    expect(mocks.sendMessageToConversation).not.toHaveBeenCalled();
  });

  it("devolve 400 ao encaminhar mensagem apagada", async () => {
    mocks.createClient.mockResolvedValue(
      comSessao({ messages: [{ ...MSG_1, deleted_at: "2026-09-14T10:00:00Z" }] }),
    );

    const res = await POST(request({ messageIds: ["msg-1"], conversationIds: ["conv-a"] }));

    expect(res.status).toBe(400);
    expect(mocks.sendMessageToConversation).not.toHaveBeenCalled();
  });

  it("devolve 400 quando um destino nao pertence a conta", async () => {
    mocks.createClient.mockResolvedValue(
      comSessao({ destinations: [{ id: "conv-a", channel_id: "chan-1" }] }),
    );

    const res = await POST(
      request({ messageIds: ["msg-1"], conversationIds: ["conv-a", "conv-de-outra-conta"] }),
    );

    expect(res.status).toBe(400);
    expect(mocks.sendMessageToConversation).not.toHaveBeenCalled();
  });

  it("encaminha 1 mensagem pra 2 destinos, marcando forwarded: true", async () => {
    mocks.createClient.mockResolvedValue(comSessao());

    const res = await POST(
      request({ messageIds: ["msg-1"], conversationIds: ["conv-a", "conv-b"] }),
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.sent).toBe(2);
    expect(mocks.sendMessageToConversation).toHaveBeenCalledTimes(2);
  });

  it("com 1 mensagem só, a nota é aplicada (comportamento antigo preservado)", async () => {
    mocks.createClient.mockResolvedValue(comSessao());

    const res = await POST(
      request({ messageIds: ["msg-1"], conversationIds: ["conv-a"], note: "Olha isso aí" }),
    );

    expect(res.status).toBe(200);
    expect(mocks.sendMessageToConversation.mock.calls[0][2]).toMatchObject({
      contentText: "bom dia\n\nOlha isso aí",
    });
  });

  it("com 2+ mensagens, a nota é ignorada (ambíguo em qual balão ela entraria)", async () => {
    mocks.createClient.mockResolvedValue(comSessao({ messages: [MSG_1, MSG_2] }));

    const res = await POST(
      request({
        messageIds: ["msg-1", "msg-2"],
        conversationIds: ["conv-a"],
        note: "não deveria aparecer em lugar nenhum",
      }),
    );

    expect(res.status).toBe(200);
    for (const call of mocks.sendMessageToConversation.mock.calls) {
      expect(call[2].contentText).not.toMatch(/não deveria aparecer/);
    }
  });

  it("entrega as mensagens na ordem cronológica original, não na ordem enviada no body", async () => {
    mocks.createClient.mockResolvedValue(comSessao({ messages: [MSG_1, MSG_2] }));

    // Body pede msg-2 primeiro, mas MSG_1.created_at é mais antigo.
    await POST(
      request({ messageIds: ["msg-2", "msg-1"], conversationIds: ["conv-a"] }),
    );

    const [firstCall, secondCall] = mocks.sendMessageToConversation.mock.calls.map(
      (c) => c[2],
    );
    expect(firstCall.contentText).toBe("bom dia"); // MSG_1, mais antiga
    expect(secondCall.contentText).toBe("tudo bem?"); // MSG_2
  });

  it("entrega DESTINO por fora, MENSAGEM por dentro — cada destino recebe o pacote completo antes do próximo começar", async () => {
    mocks.createClient.mockResolvedValue(
      comSessao({
        messages: [MSG_1, MSG_2],
        destinations: [
          { id: "conv-a", channel_id: "chan-1" },
          { id: "conv-b", channel_id: "chan-1" },
        ],
      }),
    );

    await POST(
      request({
        messageIds: ["msg-1", "msg-2"],
        conversationIds: ["conv-a", "conv-b"],
      }),
    );

    const calls = mocks.sendMessageToConversation.mock.calls.map((c) => c[2]);
    expect(calls.map((c) => c.conversationId)).toEqual([
      "conv-a",
      "conv-a",
      "conv-b",
      "conv-b",
    ]);
  });

  it("limite de taxa do provedor para o LOTE INTEIRO, não só a mensagem atual", async () => {
    mocks.createClient.mockResolvedValue(
      comSessao({
        messages: [MSG_1, MSG_2],
        destinations: [
          { id: "conv-a", channel_id: "chan-1" },
          { id: "conv-b", channel_id: "chan-1" },
        ],
      }),
    );
    const { ProviderRateLimitError } = await import("@/lib/whatsapp/providers/types");
    mocks.sendMessageToConversation.mockRejectedValueOnce(
      new ProviderRateLimitError("uazapi", { providerMessage: "limite atingido" }),
    );

    const res = await POST(
      request({
        messageIds: ["msg-1", "msg-2"],
        conversationIds: ["conv-a", "conv-b"],
      }),
    );
    const json = await res.json();

    expect(json.sent).toBe(0);
    // Só a primeira tentativa (msg-1 -> conv-a) acontece; as outras 3
    // combinações (msg-2->conv-a, msg-1->conv-b, msg-2->conv-b) nem
    // chegam a ser tentadas.
    expect(mocks.sendMessageToConversation).toHaveBeenCalledTimes(1);
    expect(json.results).toHaveLength(4);
    expect(json.results.filter((r: { ok: boolean }) => !r.ok)).toHaveLength(4);
  });

  it("uma falha comum numa combinação nao impede as demais", async () => {
    mocks.createClient.mockResolvedValue(comSessao());
    mocks.sendMessageToConversation.mockRejectedValueOnce(new Error("canal caiu"));

    const res = await POST(
      request({ messageIds: ["msg-1"], conversationIds: ["conv-a", "conv-b"] }),
    );
    const json = await res.json();

    expect(json.sent).toBe(1);
    expect(mocks.sendMessageToConversation).toHaveBeenCalledTimes(2);
  });

  it("devolve 429 quando o limite de taxa do endpoint estoura", async () => {
    mocks.createClient.mockResolvedValue(comSessao());

    for (let i = 0; i < 10; i++) {
      const ok = await POST(request({ messageIds: ["msg-1"], conversationIds: ["conv-a"] }));
      expect(ok.status).toBe(200);
    }

    const blocked = await POST(
      request({ messageIds: ["msg-1"], conversationIds: ["conv-a"] }),
    );
    expect(blocked.status).toBe(429);
  });
});

import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getProviderForConversation: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/whatsapp/providers/resolve", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/whatsapp/providers/resolve")>();
  return { ...actual, getProviderForConversation: mocks.getProviderForConversation };
});

import { POST } from "./route";
import { ProviderError, ProviderUnsupportedError } from "@/lib/whatsapp/providers/types";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

/**
 * Fake Supabase com estado real por `.eq()`/`.in()` encadeados — mesmo
 * padrão do webhook uazapi (route.test.ts) e da rota de grupos: a
 * asserção de isolamento por conta é uma prova de verdade, não decoração.
 */
function comSessao(opts: {
  role: string;
  conversa: Row | null;
  mensagens: Row[];
  updateSpy?: (payload: Row, matched: Row[]) => void;
}) {
  const { role, conversa, mensagens, updateSpy } = opts;
  return {
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }) },
    from: (table: string) => {
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { account_id: "acct-1", account_role: role },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "conversations") {
        const filtros: Record<string, unknown> = {};
        const chain = {
          select: () => chain,
          eq: (col: string, val: unknown) => {
            filtros[col] = val;
            return chain;
          },
          maybeSingle: async () => {
            if (!conversa) return { data: null, error: null };
            const bate = Object.entries(filtros).every(([c, v]) => conversa[c] === v);
            return { data: bate ? conversa : null, error: null };
          },
        };
        return chain;
      }
      // messages
      const filtros: Record<string, unknown> = {};
      let mode: "select" | "update" = "select";
      let payload: Row | null = null;
      const chain = {
        select: () => {
          mode = "select";
          return chain;
        },
        update: (p: Row) => {
          mode = "update";
          payload = p;
          return chain;
        },
        eq: (col: string, val: unknown) => {
          filtros[col] = val;
          return chain;
        },
        in: (col: string, vals: unknown[]) => {
          filtros[col] = { $in: vals };
          return chain;
        },
        then(resolve: (r: { data: Row[]; error: null }) => void) {
          const matched = mensagens.filter((m) =>
            Object.entries(filtros).every(([c, v]) =>
              v && typeof v === "object" && "$in" in (v as object)
                ? (v as { $in: unknown[] }).$in.includes(m[c])
                : m[c] === v,
            ),
          );
          if (mode === "update" && payload) {
            updateSpy?.(payload, matched);
            matched.forEach((m) => Object.assign(m, payload));
          }
          resolve({ data: matched, error: null });
        },
      };
      return chain;
    },
  };
}

function request() {
  return new Request("https://x/api/whatsapp/conversations/conv-1/mark-read", {
    method: "POST",
  });
}
const params = () => ({ params: Promise.resolve({ id: "conv-1" }) });

const CONV = { id: "conv-1", account_id: "acct-1", group_id: null };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/whatsapp/conversations/[id]/mark-read", () => {
  it("devolve 401 sem sessão", async () => {
    mocks.createClient.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    });

    const res = await POST(request(), params());

    expect(res.status).toBe(401);
  });

  it("devolve 403 para viewer — só quem pode responder marca como lido", async () => {
    mocks.createClient.mockResolvedValue(
      comSessao({ role: "viewer", conversa: CONV, mensagens: [] }),
    );

    const res = await POST(request(), params());

    expect(res.status).toBe(403);
  });

  it("devolve 404 quando a conversa não é da conta do chamador", async () => {
    mocks.createClient.mockResolvedValue(
      comSessao({ role: "agent", conversa: { ...CONV, account_id: "outra-conta" }, mensagens: [] }),
    );

    const res = await POST(request(), params());

    expect(res.status).toBe(404);
  });

  it("devolve 400 para conversa de grupo — não suportado por ora", async () => {
    mocks.createClient.mockResolvedValue(
      comSessao({ role: "agent", conversa: { ...CONV, group_id: "grp-1" }, mensagens: [] }),
    );

    const res = await POST(request(), params());

    expect(res.status).toBe(400);
    expect(mocks.getProviderForConversation).not.toHaveBeenCalled();
  });

  it("sem mensagem pendente, devolve 200 marked:0 e NÃO chama o provider", async () => {
    mocks.createClient.mockResolvedValue(
      comSessao({
        role: "agent",
        conversa: CONV,
        mensagens: [
          { id: "m1", message_id: "W1", conversation_id: "conv-1", sender_type: "customer", status: "read" },
          { id: "m2", message_id: "W2", conversation_id: "conv-1", sender_type: "agent", status: "delivered" },
        ],
      }),
    );

    const res = await POST(request(), params());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.marked).toBe(0);
    expect(mocks.getProviderForConversation).not.toHaveBeenCalled();
  });

  it("marca as mensagens pendentes do cliente via provider e grava status=read no banco", async () => {
    const updateSpy = vi.fn();
    const markAsRead = vi.fn(async () => {});
    mocks.getProviderForConversation.mockResolvedValue({ kind: "uazapi", markAsRead });
    mocks.createClient.mockResolvedValue(
      comSessao({
        role: "agent",
        conversa: CONV,
        mensagens: [
          { id: "m1", message_id: "W1", conversation_id: "conv-1", sender_type: "customer", status: "delivered" },
          { id: "m2", message_id: "W2", conversation_id: "conv-1", sender_type: "customer", status: "sent" },
          { id: "m3", message_id: "W3", conversation_id: "conv-1", sender_type: "agent", status: "delivered" },
        ],
        updateSpy,
      }),
    );

    const res = await POST(request(), params());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.marked).toBe(2);
    expect(markAsRead).toHaveBeenCalledWith({ messageIds: ["W1", "W2"] });
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ status: "read" }),
      expect.arrayContaining([
        expect.objectContaining({ id: "m1" }),
        expect.objectContaining({ id: "m2" }),
      ]),
    );
  });

  it("devolve 400 quando o canal é Meta (markAsRead não suportado)", async () => {
    mocks.getProviderForConversation.mockResolvedValue({
      kind: "meta",
      markAsRead: async () => {
        throw new ProviderUnsupportedError("meta", "markAsRead");
      },
    });
    mocks.createClient.mockResolvedValue(
      comSessao({
        role: "agent",
        conversa: CONV,
        mensagens: [
          { id: "m1", message_id: "W1", conversation_id: "conv-1", sender_type: "customer", status: "delivered" },
        ],
      }),
    );

    const res = await POST(request(), params());

    expect(res.status).toBe(400);
  });

  it("devolve 502 quando a UAZAPI recusa", async () => {
    mocks.getProviderForConversation.mockResolvedValue({
      kind: "uazapi",
      markAsRead: async () => {
        throw new ProviderError("uazapi", "boom");
      },
    });
    mocks.createClient.mockResolvedValue(
      comSessao({
        role: "agent",
        conversa: CONV,
        mensagens: [
          { id: "m1", message_id: "W1", conversation_id: "conv-1", sender_type: "customer", status: "delivered" },
        ],
      }),
    );

    const res = await POST(request(), params());

    expect(res.status).toBe(502);
  });
});

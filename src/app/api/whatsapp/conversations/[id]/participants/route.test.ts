import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getProviderForChannel: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/whatsapp/providers/resolve", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/whatsapp/providers/resolve")>();
  return { ...actual, getProviderForChannel: mocks.getProviderForChannel };
});

import { GET } from "./route";

// Simula o encadeamento .select().eq()...(.in())...(.maybeSingle() | await
// direto). `linhas` é sempre um array; cada `.eq`/`.in` acumula um filtro,
// e a resolução final aplica todos os filtros de uma vez — mesmo padrão de
// `participants/route.test.ts` (grupo), generalizado para suportar `.in`
// e o caso "sem .maybeSingle()" (lista awaited direto).
function tabela(linhas: Record<string, unknown>[]) {
  const filtros: Array<(row: Record<string, unknown>) => boolean> = [];
  const chain = {
    select: () => chain,
    eq: (coluna: string, valor: unknown) => {
      filtros.push((row) => row[coluna] === valor);
      return chain;
    },
    in: (coluna: string, valores: unknown[]) => {
      filtros.push((row) => valores.includes(row[coluna]));
      return chain;
    },
    maybeSingle: async () => {
      const achado = linhas.find((row) => filtros.every((f) => f(row)));
      return { data: achado ?? null, error: null };
    },
    then: (resolve: (result: { data: unknown; error: null }) => void) => {
      const achados = linhas.filter((row) => filtros.every((f) => f(row)));
      resolve({ data: achados, error: null });
    },
  };
  return chain;
}

interface Fixtures {
  profile?: { account_id: string } | null;
  conversations?: Record<string, unknown>[];
  groups?: Record<string, unknown>[];
  contacts?: Record<string, unknown>[];
  groupParticipants?: Record<string, unknown>[];
  semSessao?: boolean;
}

function comSessao(fx: Fixtures) {
  return {
    auth: {
      getUser: async () =>
        fx.semSessao
          ? { data: { user: null }, error: null }
          : { data: { user: { id: "user-1" } }, error: null },
    },
    from: (table: string) => {
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () =>
                fx.profile === null
                  ? { data: null, error: null }
                  : { data: fx.profile ?? { account_id: "acct-1" }, error: null },
            }),
          }),
        };
      }
      if (table === "conversations") return tabela(fx.conversations ?? []);
      if (table === "whatsapp_groups") return tabela(fx.groups ?? []);
      if (table === "contacts") return tabela(fx.contacts ?? []);
      if (table === "group_participants") return tabela(fx.groupParticipants ?? []);
      throw new Error(`tabela não simulada no teste: ${table}`);
    },
  };
}

const params = Promise.resolve({ id: "conv-1" });

const convGrupo = { id: "conv-1", account_id: "acct-1", group_id: "g-1" };
const grupoBase = {
  id: "g-1",
  channel_id: "chan-1",
  group_jid: "1@g.us",
  name: "Currículos",
  avatar_url: null,
  left_at: null,
};

describe("GET /api/whatsapp/conversations/[id]/participants", () => {
  beforeEach(() => vi.clearAllMocks());

  it("devolve 401 sem sessão", async () => {
    mocks.createClient.mockResolvedValue(comSessao({ semSessao: true }));
    const res = await GET(new Request("https://x"), { params });
    expect(res.status).toBe(401);
  });

  it("devolve 403 quando o perfil não está vinculado a uma conta", async () => {
    mocks.createClient.mockResolvedValue(comSessao({ profile: null }));
    const res = await GET(new Request("https://x"), { params });
    expect(res.status).toBe(403);
  });

  it("devolve 404 quando a RLS não devolve a conversa (sem acesso ou inexistente)", async () => {
    // Nenhuma linha em `conversations` bate — simula tanto "não existe"
    // quanto "existe mas can_see_conversation nega" (RLS de verdade
    // decide isso no banco; aqui só garantimos que a rota trata "sem
    // linha" como 404, sem distinguir os dois motivos).
    mocks.createClient.mockResolvedValue(comSessao({ conversations: [] }));
    const res = await GET(new Request("https://x"), { params });
    expect(res.status).toBe(404);
  });

  it("devolve 404 quando a conversa é de outra conta", async () => {
    mocks.createClient.mockResolvedValue(
      comSessao({ conversations: [{ ...convGrupo, account_id: "acct-OUTRA" }] }),
    );
    const res = await GET(new Request("https://x"), { params });
    expect(res.status).toBe(404);
  });

  it("devolve 400 quando a conversa não é de grupo", async () => {
    mocks.createClient.mockResolvedValue(
      comSessao({ conversations: [{ ...convGrupo, group_id: null }] }),
    );
    const res = await GET(new Request("https://x"), { params });
    expect(res.status).toBe(400);
  });

  it("devolve 404 quando o grupo referenciado não existe", async () => {
    mocks.createClient.mockResolvedValue(
      comSessao({ conversations: [convGrupo], groups: [] }),
    );
    const res = await GET(new Request("https://x"), { params });
    expect(res.status).toBe(404);
  });

  it("devolve left:true e lista vazia quando o grupo já foi deixado", async () => {
    mocks.createClient.mockResolvedValue(
      comSessao({
        conversations: [convGrupo],
        groups: [{ ...grupoBase, left_at: "2026-09-05T00:00:00Z" }],
      }),
    );
    const res = await GET(new Request("https://x"), { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.group.left).toBe(true);
    expect(body.participants).toEqual([]);
    // Não chama a uazapi para um grupo que já foi deixado.
    expect(mocks.getProviderForChannel).not.toHaveBeenCalled();
  });

  it("devolve 502 quando o provider falha", async () => {
    mocks.createClient.mockResolvedValue(
      comSessao({ conversations: [convGrupo], groups: [grupoBase] }),
    );
    mocks.getProviderForChannel.mockResolvedValue({
      getGroupParticipants: async () => {
        throw new Error("uazapi fora do ar");
      },
    });
    const res = await GET(new Request("https://x"), { params });
    expect(res.status).toBe(502);
  });

  it("resolve nome por Contatos, por nome local do WhatsApp, e cai pro telefone", async () => {
    mocks.createClient.mockResolvedValue(
      comSessao({
        conversations: [convGrupo],
        groups: [grupoBase],
        // Contato salvo SEM o DDI 55 — prova que a rota usa as
        // variantes de telefone, não só o valor cru.
        contacts: [{ account_id: "acct-1", phone_normalized: "3196897681", name: "Fulana da Escola" }],
        groupParticipants: [
          { group_id: "g-1", phone: "5531988887777", display_name: "Apelido WhatsApp" },
        ],
      }),
    );
    mocks.getProviderForChannel.mockResolvedValue({
      getGroupParticipants: async () => [
        { phoneNumber: "553196897681", isAdmin: true }, // acha via Contatos
        { phoneNumber: "5531988887777", isAdmin: false }, // acha via local
        { phoneNumber: "5511999998888", isAdmin: false }, // não acha nada
      ],
    });

    const res = await GET(new Request("https://x"), { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.group).toEqual({
      id: "g-1",
      name: "Currículos",
      avatarUrl: null,
      left: false,
    });
    expect(body.participants).toEqual([
      { phoneNumber: "553196897681", isAdmin: true, name: "Fulana da Escola" },
      { phoneNumber: "5531988887777", isAdmin: false, name: "Apelido WhatsApp" },
      { phoneNumber: "5511999998888", isAdmin: false, name: "5511999998888" },
    ]);
  });

  it("não deixa um contato de DDD diferente casar por coincidência dos 8 dígitos finais", async () => {
    mocks.createClient.mockResolvedValue(
      comSessao({
        conversations: [convGrupo],
        groups: [grupoBase],
        // DDD 31 salvo; participante real é DDD 27 — mesmos 8 dígitos finais.
        contacts: [{ account_id: "acct-1", phone_normalized: "553196897681", name: "*** Vaga (pessoa errada)" }],
      }),
    );
    mocks.getProviderForChannel.mockResolvedValue({
      getGroupParticipants: async () => [{ phoneNumber: "5527996897681", isAdmin: false }],
    });

    const res = await GET(new Request("https://x"), { params });
    const body = await res.json();

    expect(body.participants).toEqual([
      { phoneNumber: "5527996897681", isAdmin: false, name: "5527996897681" },
    ]);
  });
});

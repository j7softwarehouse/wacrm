// ============================================================
// Regressão: DUAS linhas em `whatsapp_channels` para a mesma conta.
//
// Até a Parte B, `POST /api/whatsapp/channels` não existia e a
// migração 037 registrava explicitamente que "hoje existe no máximo um
// canal por conta". Vários call sites nasceram apoiados nessa premissa
// e usam `.single()` / `.maybeSingle()` filtrando só por `account_id` —
// e AMBOS os métodos do PostgREST devolvem erro quando casam DUAS
// linhas, não só quando casam zero.
//
// Este arquivo monta o cenário que a Parte B habilita — um canal Meta
// e um canal UAZAPI na mesma conta — e passa por ele os dois caminhos
// que dão mais prejuízo:
//
//   1. DELETE /api/whatsapp/config ("Reset Meta configuration"), que
//      apagava TODOS os canais da conta, órfãos incluídos (a FK das
//      conversas é ON DELETE SET NULL: o histórico sobrevive e nunca
//      mais pode ser respondido);
//   2. o caminho de disparo agnóstico de provider (`createBroadcast`),
//      que falhava com "WhatsApp not configured".
//
// O fake do Supabase abaixo reproduz de propósito a semântica que
// causa o bug: `single()`/`maybeSingle()` ERRAM com ≥2 linhas. Sem
// isso o teste passaria mesmo com o código antigo.
// ============================================================

import { beforeEach, describe, expect, it, vi } from "vitest";

import { encrypt } from "@/lib/whatsapp/encryption";

// ------------------------------------------------------------
// Mini-PostgREST em memória
// ------------------------------------------------------------

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;

interface Filter {
  op: "eq" | "neq" | "in";
  column: string;
  value: unknown;
}

function matches(row: Row, filters: Filter[]): boolean {
  return filters.every((f) => {
    const actual = row[f.column];
    if (f.op === "eq") return actual === f.value;
    if (f.op === "neq") return actual !== f.value;
    return Array.isArray(f.value) && f.value.includes(actual);
  });
}

const PGRST116 = {
  code: "PGRST116",
  message: "JSON object requested, multiple (or no) rows returned",
};

let idSeq = 0;

function createFakeSupabase(tables: Tables) {
  function from(table: string) {
    const filters: Filter[] = [];
    let mode: "select" | "insert" | "update" | "delete" = "select";
    let payload: Row[] = [];
    let orderBy: { column: string; ascending: boolean } | null = null;
    let limitN: number | null = null;

    const rowsOf = () => (tables[table] ??= []);

    function run(): { data: Row[]; error: unknown } {
      const all = rowsOf();

      if (mode === "insert") {
        const inserted = payload.map((p) => ({
          id: p.id ?? `row-${++idSeq}`,
          created_at: p.created_at ?? new Date().toISOString(),
          ...p,
        }));
        all.push(...inserted);
        return { data: inserted, error: null };
      }

      let hits = all.filter((r) => matches(r, filters));

      if (mode === "delete") {
        tables[table] = all.filter((r) => !matches(r, filters));
        return { data: hits, error: null };
      }

      if (mode === "update") {
        const patch = payload[0] ?? {};
        for (const r of hits) Object.assign(r, patch);
        return { data: hits, error: null };
      }

      if (orderBy) {
        const { column, ascending } = orderBy;
        hits = [...hits].sort((a, b) => {
          const av = String(a[column] ?? "");
          const bv = String(b[column] ?? "");
          return ascending ? av.localeCompare(bv) : bv.localeCompare(av);
        });
      }
      if (limitN !== null) hits = hits.slice(0, limitN);
      return { data: hits, error: null };
    }

    const builder: Record<string, unknown> = {
      select: () => builder,
      insert: (p: Row | Row[]) => {
        mode = "insert";
        payload = Array.isArray(p) ? p : [p];
        return builder;
      },
      update: (p: Row) => {
        mode = "update";
        payload = [p];
        return builder;
      },
      delete: () => {
        mode = "delete";
        return builder;
      },
      eq: (column: string, value: unknown) => {
        filters.push({ op: "eq", column, value });
        return builder;
      },
      neq: (column: string, value: unknown) => {
        filters.push({ op: "neq", column, value });
        return builder;
      },
      in: (column: string, value: unknown[]) => {
        filters.push({ op: "in", column, value });
        return builder;
      },
      order: (column: string, opts?: { ascending?: boolean }) => {
        orderBy = { column, ascending: opts?.ascending ?? true };
        return builder;
      },
      limit: (n: number) => {
        limitN = n;
        return builder;
      },
      // ── terminais ────────────────────────────────────────────
      // A regra que importa: DUAS linhas casando é ERRO, exatamente
      // como o PostgREST faz. É esse comportamento que quebrava tudo
      // assim que a conta ganhava um segundo canal.
      maybeSingle: async () => {
        const { data, error } = run();
        if (error) return { data: null, error };
        if (data.length > 1) return { data: null, error: PGRST116 };
        return { data: data[0] ?? null, error: null };
      },
      single: async () => {
        const { data, error } = run();
        if (error) return { data: null, error };
        if (data.length !== 1) return { data: null, error: PGRST116 };
        return { data: data[0], error: null };
      },
      then: (
        resolve: (v: { data: Row[]; error: unknown }) => unknown,
        reject?: (e: unknown) => unknown,
      ) => {
        try {
          return Promise.resolve(resolve(run()));
        } catch (err) {
          return reject ? Promise.resolve(reject(err)) : Promise.reject(err);
        }
      },
    };

    return builder;
  }

  return {
    from,
    auth: {
      getUser: async () => ({ data: { user: { id: "user-1" } }, error: null }),
    },
  };
}

// ------------------------------------------------------------
// Cenário: uma conta, dois canais (Meta mais antigo, UAZAPI novo)
// ------------------------------------------------------------

const ACCOUNT_ID = "acct-1";

let tables: Tables;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let fake: any;

function seed() {
  tables = {
    profiles: [{ user_id: "user-1", account_id: ACCOUNT_ID }],
    whatsapp_channels: [
      {
        id: "chan-meta",
        account_id: ACCOUNT_ID,
        user_id: "user-1",
        provider: "meta",
        status: "connected",
        created_at: "2026-01-01T00:00:00.000Z",
        phone_number_id: "PNID-1",
        waba_id: "WABA-1",
        access_token: encrypt("meta-token"),
      },
      {
        id: "chan-uazapi",
        account_id: ACCOUNT_ID,
        user_id: "user-1",
        provider: "uazapi",
        status: "connected",
        created_at: "2026-06-01T00:00:00.000Z",
        uazapi_base_url: "https://acme.uazapi.com",
        uazapi_token: encrypt("uazapi-token"),
        webhook_secret: "s".repeat(64),
      },
    ],
    conversations: [
      {
        id: "conv-uazapi",
        account_id: ACCOUNT_ID,
        contact_id: "contact-1",
        channel_id: "chan-uazapi",
      },
    ],
    message_templates: [],
    broadcasts: [],
    broadcast_recipients: [],
  };
  fake = createFakeSupabase(tables);
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => fake,
}));

// A rota de config instancia um cliente service-role para detectar um
// phone_number_id já reivindicado por OUTRA conta; aponta para o mesmo
// store em memória.
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => fake,
}));

// Sem rede: a rota valida credenciais contra a Graph API.
vi.mock("@/lib/whatsapp/meta-api", () => ({
  verifyPhoneNumber: async () => ({ display_phone_number: "+1 555" }),
  registerPhoneNumber: async () => ({}),
  subscribeWabaToApp: async () => ({}),
}));

// O contato resolvido não é o objeto deste teste — o que importa é o
// canal escolhido pelo disparo.
vi.mock("@/lib/api/v1/contacts", () => ({
  findOrCreateContact: async () => ({ id: "contact-1", created: false }),
  resolveAuditUserId: async () => "user-1",
  ContactError: class ContactError extends Error {},
}));

beforeEach(() => {
  seed();
});

// ------------------------------------------------------------
// 1. "Reset Meta configuration" não pode encostar no canal UAZAPI
// ------------------------------------------------------------

describe("DELETE /api/whatsapp/config com dois canais", () => {
  it("apaga só o canal Meta e preserva o UAZAPI", async () => {
    const { DELETE } = await import("@/app/api/whatsapp/config/route");

    const res = await DELETE();
    expect(res.status).toBe(200);

    const remaining = tables.whatsapp_channels;
    expect(remaining.map((c) => c.id)).toEqual(["chan-uazapi"]);
  });

  it("não desvincula as conversas do canal sobrevivente", async () => {
    // A FK é ON DELETE SET NULL: se o DELETE pegasse o canal UAZAPI,
    // esta conversa perderia o canal para sempre (histórico somente
    // leitura, sem resposta possível).
    const { DELETE } = await import("@/app/api/whatsapp/config/route");
    await DELETE();

    expect(tables.conversations[0].channel_id).toBe("chan-uazapi");
  });
});

// ------------------------------------------------------------
// 2. Leituras Meta-específicas continuam resolvendo
// ------------------------------------------------------------

describe("GET /api/whatsapp/config com dois canais", () => {
  it("resolve o canal Meta em vez de errar com PGRST116", async () => {
    const { GET } = await import("@/app/api/whatsapp/config/route");

    const res = await GET();
    const body = await res.json();

    // Antes do filtro por provider isto virava `db_error` / `no_config`
    // e a tela de Configurações dizia "não conectado" para sempre.
    expect(body.connected).toBe(true);
  });
});

// ------------------------------------------------------------
// 3. Caminhos agnósticos de provider usam o canal padrão (o mais antigo)
// ------------------------------------------------------------

describe("resolução do canal padrão com dois canais", () => {
  it("resolveDefaultChannelId devolve o canal mais antigo", async () => {
    const { resolveDefaultChannelId } = await import(
      "@/lib/whatsapp/providers/resolve"
    );
    await expect(resolveDefaultChannelId(fake, ACCOUNT_ID)).resolves.toBe(
      "chan-meta",
    );
  });

  it("createBroadcast dispara pelo canal padrão em vez de falhar com whatsapp_not_configured", async () => {
    const { createBroadcast } = await import("@/lib/whatsapp/broadcast-core");

    const plan = await createBroadcast(fake, ACCOUNT_ID, "user-1", {
      templateName: "hello_world",
      recipients: [{ to: "+14155550123", params: [] }],
    });

    expect(plan.provider.kind).toBe("meta");
    expect(tables.broadcasts[0].channel_id).toBe("chan-meta");
  });
});

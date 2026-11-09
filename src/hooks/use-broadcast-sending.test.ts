import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Regressão do corte de 1000 linhas do PostgREST no envio de Broadcast.
// O fake abaixo imita o servidor: cada consulta devolve no máximo 1000
// linhas, como o PostgREST faz por padrão.

const fake = vi.hoisted(() => {
  const MAX_ROWS = 1000;
  const db: Record<string, any[]> = {
    contacts: [],
    contact_tags: [],
    contact_custom_values: [],
    broadcasts: [],
    broadcast_recipients: [],
  };
  /** Tabela cujas leituras devolvem erro (simula falha do servidor). */
  const state = { errorTable: null as string | null };

  function makeBuilder(table: string) {
    const st = {
      filters: [] as ((r: any) => boolean)[],
      range: null as null | [number, number],
      op: "select" as "select" | "insert" | "update",
      payload: null as any,
      single: false,
      join: false,
    };
    const api: any = {
      select(cols?: string) {
        if (cols?.includes("contact:contacts")) st.join = true;
        return api;
      },
      in(col: string, vals: any[]) {
        const set = new Set(vals);
        st.filters.push((r) => set.has(r[col]));
        return api;
      },
      eq(col: string, v: any) {
        st.filters.push((r) => r[col] === v);
        return api;
      },
      neq(col: string, v: any) {
        st.filters.push((r) => r[col] !== v);
        return api;
      },
      ilike() {
        return api;
      },
      order() {
        return api;
      },
      range(from: number, to: number) {
        st.range = [from, to];
        return api;
      },
      insert(rows: any) {
        st.op = "insert";
        st.payload = Array.isArray(rows) ? rows : [rows];
        return api;
      },
      update(patch: any) {
        st.op = "update";
        st.payload = patch;
        return api;
      },
      single() {
        st.single = true;
        return api;
      },
      then(resolve: any, reject: any) {
        return Promise.resolve(run()).then(resolve, reject);
      },
    };

    function run() {
      if (st.op === "insert") {
        const rows = st.payload.map((r: any, i: number) => ({
          id: `${table}-${db[table].length + i}`,
          ...r,
        }));
        db[table].push(...rows);
        return { data: st.single ? rows[0] : rows, error: null };
      }
      if (fake.state.errorTable === table && st.op === "select") {
        return { data: null, error: { message: "simulated read failure" } };
      }

      if (st.op === "update") {
        db[table]
          .filter((r) => st.filters.every((f) => f(r)))
          .forEach((r) => Object.assign(r, st.payload));
        return { data: null, error: null };
      }

      let rows = db[table].filter((r) => st.filters.every((f) => f(r)));
      if (st.join) {
        rows = rows.map((r) => ({
          ...r,
          contact: db.contacts.find((c) => c.id === r.contact_id) ?? null,
        }));
      }
      // Como o PostgREST: TODA resposta é limitada a MAX_ROWS, com ou sem
      // range. Sem range, o corte é silencioso (é o bug original).
      const [from, to] = st.range ?? [0, Number.MAX_SAFE_INTEGER];
      rows = rows.slice(from, Math.min(to + 1, from + MAX_ROWS));
      return { data: rows, error: null };
    }

    return api;
  }

  const supabase = {
    auth: {
      getSession: async () => ({
        data: { session: { user: { id: "user-1" } } },
      }),
    },
    from: (table: string) => makeBuilder(table),
  };

  return { db, supabase, state };
});

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => fake.supabase,
}));

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ accountId: "account-1" }),
}));

// O hook só usa useState; trocamos por um equivalente simples, sem renderer.
vi.mock("react", () => ({
  useState: <T,>(init: T | (() => T)) => [
    typeof init === "function" ? (init as () => T)() : init,
    () => {},
  ],
}));

describe("createAndSendBroadcast — audiência completa (sem corte de 1000)", () => {
  const TOTAL = 2500;
  const EXCLUDED = 1200; // contatos 0..1199 têm a tag de exclusão
  let sentPhones: string[];

  beforeEach(() => {
    fake.db.contacts = Array.from({ length: TOTAL }, (_, i) => ({
      id: `contact-${i}`,
      phone: `5511${String(i).padStart(8, "0")}`,
      name: `Contato ${i}`,
      email: null,
      company: null,
      user_id: "user-1",
      account_id: "account-1",
    }));
    fake.db.contact_tags = [
      ...Array.from({ length: TOTAL }, (_, i) => ({
        id: `ct-vip-${i}`,
        contact_id: `contact-${i}`,
        tag_id: "vip",
      })),
      ...Array.from({ length: EXCLUDED }, (_, i) => ({
        id: `ct-bloq-${i}`,
        contact_id: `contact-${i}`,
        tag_id: "bloq",
      })),
    ];
    fake.db.contact_custom_values = [];
    fake.db.broadcasts = [];
    fake.db.broadcast_recipients = [];
    fake.state.errorTable = null;

    sentPhones = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: { body: string }) => {
        const body = JSON.parse(init.body);
        sentPhones.push(...body.recipients.map((r: { phone: string }) => r.phone));
        return {
          ok: true,
          json: async () => ({
            results: body.recipients.map((r: { phone: string }) => ({
              phone: r.phone,
              status: "sent",
              whatsapp_message_id: "m",
            })),
          }),
        };
      }),
    );
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("envia para todos os contatos da tag, menos os excluídos, sem cortar em 1000", async () => {
    const { useBroadcastSending } = await import("./use-broadcast-sending");
    const { createAndSendBroadcast } = useBroadcastSending();

    const run = createAndSendBroadcast({
      name: "teste",
      template: { name: "modelo", language: "pt_BR" } as any,
      audience: { type: "tags", tagIds: ["vip"], excludeTagIds: ["bloq"] },
      variables: {},
    });
    await vi.runAllTimersAsync();
    await run;

    const expected = TOTAL - EXCLUDED; // 1300
    expect(sentPhones).toHaveLength(expected);
    expect(new Set(sentPhones).size).toBe(expected);

    // Nenhum contato excluído pode ter recebido a mensagem.
    const excludedPhones = new Set(
      fake.db.contacts
        .filter((c) => fake.db.contact_tags.some((t) => t.contact_id === c.id && t.tag_id === "bloq"))
        .map((c) => c.phone),
    );
    expect(sentPhones.some((p) => excludedPhones.has(p))).toBe(false);

    // O total gravado no broadcast bate com o que foi enviado.
    expect(fake.db.broadcasts[0].total_recipients).toBe(expected);
    expect(fake.db.broadcast_recipients).toHaveLength(expected);
  });
});

describe("createAndSendBroadcast — correções de envio (fase 1)", () => {
  let sentPhones: string[];

  function stubFetch() {
    sentPhones = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: { body: string }) => {
        const body = JSON.parse(init.body);
        sentPhones.push(...body.recipients.map((r: { phone: string }) => r.phone));
        return {
          ok: true,
          json: async () => ({
            results: body.recipients.map((r: { phone: string }) => ({
              phone: r.phone,
              status: "sent",
              whatsapp_message_id: "m",
            })),
          }),
        };
      }),
    );
  }

  beforeEach(() => {
    fake.db.contacts = [];
    fake.db.contact_tags = [];
    fake.db.contact_custom_values = [];
    fake.db.broadcasts = [];
    fake.db.broadcast_recipients = [];
    fake.state.errorTable = null;
    stubFetch();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function send(audience: any) {
    const { useBroadcastSending } = await import("./use-broadcast-sending");
    const { createAndSendBroadcast } = useBroadcastSending();
    const run = createAndSendBroadcast({
      name: "teste",
      template: { name: "modelo", language: "pt_BR" } as any,
      audience,
      variables: {},
    });
    // Captura a rejeição antes de avançar os timers, para não virar erro não tratado.
    const settled = run.then(
      (id) => ({ ok: true as const, id }),
      (err) => ({ ok: false as const, err }),
    );
    await vi.runAllTimersAsync();
    return settled;
  }

  it("mesma pessoa com formas diferentes do número recebe uma só vez", async () => {
    fake.db.contacts = [
      { id: "a", phone: "31 98640-5178", name: "A", user_id: "user-1", account_id: "account-1" },
      { id: "b", phone: "553186405178", name: "B", user_id: "user-1", account_id: "account-1" },
      { id: "c", phone: "31 99999-0000", name: "C", user_id: "user-1", account_id: "account-1" },
    ];
    fake.db.contact_tags = ["a", "b", "c"].map((id) => ({ id: `t-${id}`, contact_id: id, tag_id: "vip" }));

    const res = await send({ type: "tags", tagIds: ["vip"] });

    expect(res.ok).toBe(true);
    expect(sentPhones).toHaveLength(2);
    expect(fake.db.broadcasts[0].total_recipients).toBe(2);
  });

  it("lote inteiro sem telefone é marcado como falha, não fica pendente", async () => {
    fake.db.contacts = [
      { id: "a", phone: "", name: "Sem fone 1", user_id: "user-1", account_id: "account-1" },
      { id: "b", phone: null, name: "Sem fone 2", user_id: "user-1", account_id: "account-1" },
    ];
    fake.db.contact_tags = ["a", "b"].map((id) => ({ id: `t-${id}`, contact_id: id, tag_id: "vip" }));

    const res = await send({ type: "tags", tagIds: ["vip"] });

    expect(res.ok).toBe(true);
    expect(sentPhones).toHaveLength(0);
    for (const r of fake.db.broadcast_recipients) {
      expect(r.status).toBe("failed");
      expect(r.error_message).toBe("No phone number on contact");
    }
    expect(fake.db.broadcasts[0].status).toBe("failed");
  });

  it("erro depois de criar o broadcast marca o broadcast como failed, não deixa em sending", async () => {
    fake.db.contacts = [
      { id: "a", phone: "31 98640-5178", name: "A", user_id: "user-1", account_id: "account-1" },
    ];
    fake.db.contact_tags = [{ id: "t-a", contact_id: "a", tag_id: "vip" }];
    fake.state.errorTable = "contact_custom_values";

    const res = await send({ type: "tags", tagIds: ["vip"] });

    expect(res.ok).toBe(false);
    expect(fake.db.broadcasts[0].status).toBe("failed");
    expect(sentPhones).toHaveLength(0);
  });
});

describe("createAndSendBroadcast — CSV e padrão de telefone", () => {
  beforeEach(() => {
    fake.db.contacts = [
      // Contato antigo, salvo de outro jeito, mesmo número do CSV.
      { id: "old", phone: "553183886076", phone_normalized: "553183886076", name: "Antiga", source: "manual", user_id: "user-1", account_id: "account-1" },
    ];
    fake.db.contact_tags = [];
    fake.db.contact_custom_values = [];
    fake.db.broadcasts = [];
    fake.db.broadcast_recipients = [];
    fake.state.errorTable = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: { body: string }) => {
        const body = JSON.parse(init.body);
        return {
          ok: true,
          json: async () => ({
            results: body.recipients.map((r: { phone: string }) => ({ phone: r.phone, status: "sent", whatsapp_message_id: "m" })),
          }),
        };
      }),
    );
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("não duplica quem já existe em outro formato e grava o novo no padrão +55 DD XXXX-XXXX", async () => {
    const { useBroadcastSending } = await import("./use-broadcast-sending");
    const { createAndSendBroadcast } = useBroadcastSending();
    const run = createAndSendBroadcast({
      name: "csv",
      template: { name: "modelo", language: "pt_BR" } as any,
      audience: {
        type: "csv",
        csvContacts: [
          { phone: "31 98388-6076", name: "Antiga" },
          { phone: "5531999990000", name: "Nova" },
        ],
      },
      variables: {},
    });
    const settled = run.then(() => "ok", (e) => `erro: ${e.message}`);
    await vi.runAllTimersAsync();
    expect(await settled).toBe("ok");

    // Só um contato novo foi criado, e com o telefone no padrão.
    const criados = fake.db.contacts.filter((c) => c.id !== "old");
    expect(criados).toHaveLength(1);
    expect(criados[0].phone).toBe("+55 31 99999-0000");
    // Nenhum contato antigo foi duplicado.
    expect(fake.db.contacts).toHaveLength(2);
  });
});

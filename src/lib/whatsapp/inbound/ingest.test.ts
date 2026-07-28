import { describe, expect, it, vi } from "vitest";
import type { InboundContent } from "./ingest";
import { buildConversationPreview, isDuplicateMessage } from "./ingest";

// Os motores de flows/automations/AI e a entrega de webhooks são
// efeitos colaterais disparados DEPOIS que a mensagem já foi gravada —
// nada do que este arquivo prova depende deles, e cada um abriria seu
// próprio cliente Supabase. Inertes aqui.
vi.mock("@/lib/flows/engine", () => ({
  dispatchInboundToFlows: vi.fn(async () => ({
    consumed: false,
    outcome: "no_match",
  })),
}));
vi.mock("@/lib/automations/engine", () => ({
  runAutomationsForTrigger: vi.fn(async () => undefined),
}));
vi.mock("@/lib/ai/auto-reply", () => ({
  dispatchInboundToAiReply: vi.fn(async () => undefined),
}));
vi.mock("@/lib/webhooks/deliver", () => ({
  dispatchWebhookEvent: vi.fn(async () => undefined),
}));

describe("buildConversationPreview", () => {
  it("usa o texto quando existe", () => {
    const content: InboundContent = { type: "text", text: "bom dia" };
    expect(buildConversationPreview(content)).toBe("bom dia");
  });

  it("usa um rótulo entre colchetes para mídia sem legenda", () => {
    const content: InboundContent = { type: "image" };
    expect(buildConversationPreview(content)).toBe("[image]");
  });

  it("prefere a legenda ao rótulo quando a mídia tem legenda", () => {
    const content: InboundContent = { type: "image", text: "olha isso" };
    expect(buildConversationPreview(content)).toBe("olha isso");
  });
});

describe("isDuplicateMessage", () => {
  it("reconhece a violação de unicidade do message_id como reentrega", () => {
    // Webhook é at-least-once. A reentrega precisa ser silenciosa,
    // não um 500 que faz o provedor tentar de novo em loop.
    expect(isDuplicateMessage({ code: "23505" })).toBe(true);
  });

  it("não confunde outros erros com duplicata", () => {
    expect(isDuplicateMessage({ code: "23503" })).toBe(false);
    expect(isDuplicateMessage(null)).toBe(false);
  });
});

// ============================================================
// Fake Supabase em memória.
//
// Só o suficiente para o caminho de ingestão: os encadeamentos que
// `ingest.ts` e `findExistingContact` realmente usam. O ponto de ter um
// fake com ESTADO (em vez de stubs que devolvem linhas fixas) é que a
// asserção "quantas conversas existem no fim" vira observável — é
// exatamente ela que pega a regressão.
// ============================================================

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

/** Chave da UNIQUE (account_id, contact_id, channel_id) NULLS NOT
 *  DISTINCT criada pela migração 037. NULLS NOT DISTINCT é o que faz
 *  duas conversas órfãs colidirem entre si — e é justamente por isso
 *  que a linha órfã do cenário abaixo ocupa uma fatia que um segundo
 *  INSERT sem canal não conseguiria reutilizar. */
function conversationKey(row: Row): string {
  return [row.account_id, row.contact_id, row.channel_id ?? "__NULL__"].join(
    "|",
  );
}

class FakeQuery {
  private conds: ((row: Row) => boolean)[] = [];
  private mode: "select" | "insert" | "update" = "select";
  private payload: Row | null = null;
  private orderCol: string | null = null;
  private orderAsc = true;
  private limitN: number | null = null;
  private wantsCount = false;
  private headOnly = false;

  constructor(
    private readonly db: FakeDb,
    private readonly table: string,
  ) {}

  private get rows(): Row[] {
    if (!this.db.tables[this.table]) this.db.tables[this.table] = [];
    return this.db.tables[this.table];
  }

  select(_cols?: string, opts?: { count?: string; head?: boolean }) {
    if (this.mode === "select") this.mode = "select";
    if (opts?.count) this.wantsCount = true;
    if (opts?.head) this.headOnly = true;
    return this;
  }

  insert(payload: Row) {
    this.mode = "insert";
    this.payload = payload;
    return this;
  }

  update(payload: Row) {
    this.mode = "update";
    this.payload = payload;
    return this;
  }

  eq(col: string, val: unknown) {
    this.conds.push((r) => r[col] === val);
    return this;
  }

  is(col: string, val: unknown) {
    this.conds.push((r) => (r[col] ?? null) === val);
    return this;
  }

  in(col: string, vals: unknown[]) {
    this.conds.push((r) => vals.includes(r[col]));
    return this;
  }

  like(col: string, pattern: string) {
    const re = new RegExp(
      "^" + pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*") + "$",
    );
    this.conds.push((r) => typeof r[col] === "string" && re.test(r[col]));
    return this;
  }

  /** Gramática `col.op.value,col.op.value` do PostgREST (só os
   *  operadores que o código sob teste emite: `eq` e `is`). */
  or(expr: string) {
    const preds = expr.split(",").map((part) => {
      const [col, op, ...rest] = part.split(".");
      const raw = rest.join(".");
      const val = raw === "null" ? null : raw;
      if (op === "is") return (r: Row) => (r[col] ?? null) === val;
      if (op === "eq") return (r: Row) => r[col] === val;
      throw new Error(`fake supabase: operador .or() não suportado: ${op}`);
    });
    this.conds.push((r) => preds.some((p) => p(r)));
    return this;
  }

  order(col: string, opts?: { ascending?: boolean }) {
    this.orderCol = col;
    this.orderAsc = opts?.ascending ?? true;
    return this;
  }

  limit(n: number) {
    this.limitN = n;
    return this;
  }

  single() {
    const res = this.run();
    const arr = (res.data as Row[] | null) ?? [];
    if (res.error) return Promise.resolve(res);
    if (arr.length !== 1) {
      return Promise.resolve({
        data: null,
        error: { code: "PGRST116", message: "expected exactly one row" },
      });
    }
    return Promise.resolve({ data: arr[0], error: null });
  }

  maybeSingle() {
    const res = this.run();
    const arr = (res.data as Row[] | null) ?? [];
    if (res.error) return Promise.resolve(res);
    if (arr.length > 1) {
      return Promise.resolve({
        data: null,
        error: { code: "PGRST116", message: "multiple rows returned" },
      });
    }
    return Promise.resolve({ data: arr[0] ?? null, error: null });
  }

  then(resolve: (v: any) => unknown, reject?: (e: unknown) => unknown) {
    try {
      return Promise.resolve(this.run()).then(resolve, reject);
    } catch (err) {
      return Promise.reject(err).then(resolve, reject);
    }
  }

  private run(): { data: Row[] | null; error: Row | null; count?: number } {
    if (this.mode === "insert") {
      const created: Row = {
        id: `${this.table}-${this.db.nextId++}`,
        created_at: new Date(this.db.clock++).toISOString(),
        ...this.payload,
      };
      if (this.table === "conversations") {
        const key = conversationKey(created);
        if (this.rows.some((r) => conversationKey(r) === key)) {
          // Índice único da 037 rejeitando a duplicata.
          return {
            data: null,
            error: {
              code: "23505",
              message:
                "duplicate key value violates unique constraint " +
                '"idx_conversations_account_contact_channel"',
            },
          };
        }
      }
      this.rows.push(created);
      return { data: [created], error: null };
    }

    const matched = this.rows.filter((r) => this.conds.every((c) => c(r)));

    if (this.mode === "update") {
      for (const r of matched) Object.assign(r, this.payload);
      return { data: matched, error: null };
    }

    let out = [...matched];
    if (this.orderCol) {
      const col = this.orderCol;
      out.sort((a, b) => {
        const av = String(a[col] ?? "");
        const bv = String(b[col] ?? "");
        return this.orderAsc ? av.localeCompare(bv) : bv.localeCompare(av);
      });
    }
    const count = out.length;
    if (this.limitN !== null) out = out.slice(0, this.limitN);
    if (this.headOnly) return { data: null, error: null, count };
    return this.wantsCount
      ? { data: out, error: null, count }
      : { data: out, error: null };
  }
}

class FakeDb {
  tables: Record<string, Row[]> = {};
  nextId = 1;
  /** Relógio monotônico para `created_at` — ordenar por ele precisa ser
   *  determinístico, e Date.now() empata dentro de um mesmo tick. */
  clock = 1_700_000_000_000;

  constructor(seed: Record<string, Row[]> = {}) {
    this.tables = seed;
  }

  from(table: string) {
    return new FakeQuery(this, table);
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

describe("ingestInboundMessage — conversa órfã sem channel_id", () => {
  it("adota a conversa existente em vez de criar uma segunda", async () => {
    // Regressão do achado Crítico da revisão de branch inteira.
    //
    // Cenário: o contato foi abordado PRIMEIRO pelo dashboard (ou pela
    // API pública), caminhos que só conhecem a conta e por isso criavam
    // a conversa com `channel_id` NULL. Quando ele responde, a busca do
    // webhook — estritamente `.eq('channel_id', channel.id)` — não
    // enxergava a linha órfã (NULL ≠ chan-1) e abria uma SEGUNDA
    // conversa. A partir daí o contato tinha duas threads, e o próximo
    // envio pelo dashboard batia na fatia única (conta, contato, NULL)
    // que a órfã já ocupava → 500 permanente.
    //
    // O mesmo estado também surge do "Resetar configuração": apagar o
    // canal dispara ON DELETE SET NULL em todas as conversas da conta.
    const { ingestInboundMessage } = await import("./ingest");

    const channel = {
      id: "chan-1",
      account_id: "acc-1",
      user_id: "user-1",
      provider: "meta",
      status: "connected",
      phone_number_id: "PNID",
    };

    const db = new FakeDb({
      contacts: [
        {
          id: "contact-1",
          account_id: "acc-1",
          user_id: "user-1",
          phone: "+5511999998888",
          name: "Fulano",
        },
      ],
      // A órfã: criada por um envio de saída antes de qualquer entrada.
      conversations: [
        {
          id: "conv-orfa",
          account_id: "acc-1",
          user_id: "user-1",
          contact_id: "contact-1",
          channel_id: null,
          unread_count: 0,
          created_at: new Date(1_600_000_000_000).toISOString(),
        },
      ],
      messages: [],
      broadcast_recipients: [],
    });

    const result = await ingestInboundMessage(db as never, {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      channel: channel as any,
      from: "+5511999998888",
      pushName: "Fulano",
      providerMessageId: "wamid.ABC",
      timestamp: 1_700_000_000,
      content: { type: "text", text: "oi, respondendo" },
    });

    expect(result).not.toBeNull();

    // (a) Nenhuma conversa nova — a órfã foi reaproveitada.
    expect(db.tables.conversations).toHaveLength(1);
    expect(result!.conversationId).toBe("conv-orfa");

    // (b) E foi curada: o channel_id ficou preenchido, então a próxima
    //     busca (de qualquer lado) casa pelo caminho estrito.
    expect(db.tables.conversations[0].channel_id).toBe("chan-1");

    // A mensagem foi mesmo gravada na thread sobrevivente.
    expect(db.tables.messages).toHaveLength(1);
    expect(db.tables.messages[0].conversation_id).toBe("conv-orfa");
    expect(db.tables.messages[0].message_id).toBe("wamid.ABC");
  });
});

import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildContactImportPatch,
  buildContactSyncUpdate,
  dedupeByPhone,
  findExistingContact,
  isExactMatch,
  isUniqueViolation,
  normalizeKey,
} from "./dedupe";

describe("normalizeKey", () => {
  it("strips every non-digit", () => {
    expect(normalizeKey("+1 (555) 123-4567")).toBe("15551234567");
    expect(normalizeKey("15551234567")).toBe("15551234567");
  });

  it("collapses different formats of the same number to one key", () => {
    expect(normalizeKey("+44 7911 123456")).toBe(normalizeKey("447911123456"));
  });
});

describe("isExactMatch", () => {
  it("treats different formatting of the same digits as exact", () => {
    expect(isExactMatch({ id: "1", phone: "+1 555-123-4567" }, "15551234567")).toBe(
      true,
    );
  });

  it("is false for a trunk-variant (fuzzy) match", () => {
    // last-8 match but not the same full number
    expect(isExactMatch({ id: "1", phone: "37063949836" }, "370063949836")).toBe(
      false,
    );
  });
});

describe("isUniqueViolation", () => {
  it("detects Postgres 23505", () => {
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
  });
  it("is false for other errors / non-objects", () => {
    expect(isUniqueViolation({ code: "23502" })).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation("boom")).toBe(false);
  });
});

describe("dedupeByPhone", () => {
  it("keeps the first occurrence and counts in-file duplicates", () => {
    const { unique, duplicates } = dedupeByPhone([
      { phone: "+1 555-1111", name: "A" },
      { phone: "15551111", name: "B" }, // same digits as #1
      { phone: "+1 555-2222", name: "C" },
    ]);
    expect(unique.map((r) => r.name)).toEqual(["A", "C"]);
    expect(duplicates).toBe(1);
  });

  it("drops rows with no digits", () => {
    const { unique, duplicates } = dedupeByPhone([
      { phone: "   " },
      { phone: "+1 555-3333" },
    ]);
    expect(unique).toHaveLength(1);
    expect(duplicates).toBe(1);
  });
});

describe("buildContactSyncUpdate", () => {
  it("updates a field when the incoming value differs from what's stored", () => {
    const update = buildContactSyncUpdate(
      { name: "Ana Antiga", email: null, company: null },
      { name: "Ana Nova" },
    );
    expect(update).toEqual({ name: "Ana Nova" });
  });

  it("updates multiple fields at once", () => {
    const update = buildContactSyncUpdate(
      { name: "Ana Antiga", email: null, company: "Empresa A" },
      { name: "Ana Nova", email: "ana@ex.com", company: "Empresa B" },
    );
    expect(update).toEqual({
      name: "Ana Nova",
      email: "ana@ex.com",
      company: "Empresa B",
    });
  });

  it("returns null when the incoming value is identical to what's stored", () => {
    const update = buildContactSyncUpdate(
      { name: "Ana", email: null, company: null },
      { name: "Ana" },
    );
    expect(update).toBeNull();
  });

  it("never blanks out a stored field with an empty incoming value", () => {
    const update = buildContactSyncUpdate(
      { name: "Ana", email: "ana@ex.com", company: null },
      { name: "", email: undefined, company: "" },
    );
    expect(update).toBeNull();
  });

  it("trims the incoming value before comparing and writing", () => {
    const update = buildContactSyncUpdate(
      { name: "Ana", email: null, company: null },
      { name: "  Ana Nova  " },
    );
    expect(update).toEqual({ name: "Ana Nova" });
  });

  it("returns null when nothing in the incoming payload differs", () => {
    const update = buildContactSyncUpdate(
      { name: "Ana", email: "ana@ex.com", company: "Empresa" },
      {},
    );
    expect(update).toBeNull();
  });
});

describe("buildContactImportPatch", () => {
  // Reimportar a planilha oficial é, na prática, o mesmo ato que abrir
  // o contato e salvar: alguém confirmou que aquele telefone é aquela
  // pessoa. Um contato criado por mensagem recebida (source
  // 'whatsapp'/nulo) que aparece na planilha deve sair da fila de
  // "Novo" mesmo quando o nome já bate e não há nada mais a atualizar.
  it("promove um contato 'whatsapp' para 'import' mesmo sem diferença de nome", () => {
    const patch = buildContactImportPatch(
      { name: "Sara Escola", email: null, company: null, source: "whatsapp" },
      { name: "Sara Escola" },
    );
    expect(patch).toEqual({ source: "import" });
  });

  it("promove e sincroniza o nome ao mesmo tempo quando os dois diferem", () => {
    const patch = buildContactImportPatch(
      { name: "Ste", email: null, company: null, source: "whatsapp" },
      { name: "Stephany Mãe Benjamim" },
    );
    expect(patch).toEqual({ name: "Stephany Mãe Benjamim", source: "import" });
  });

  it("trata ausência de origem (legado) como não identificado", () => {
    const patch = buildContactImportPatch(
      { name: "Sara Escola", email: null, company: null, source: null },
      { name: "Sara Escola" },
    );
    expect(patch).toEqual({ source: "import" });
  });

  it("nunca reabre um contato já identificado (import ou manual)", () => {
    expect(
      buildContactImportPatch(
        { name: "Ana", email: null, company: null, source: "manual" },
        { name: "Ana" },
      ),
    ).toBeNull();
    expect(
      buildContactImportPatch(
        { name: "Ana", email: null, company: null, source: "import" },
        { name: "Ana" },
      ),
    ).toBeNull();
  });

  it("sincroniza campos sem mexer na origem quando já identificado", () => {
    const patch = buildContactImportPatch(
      { name: "Ana Velha", email: null, company: null, source: "manual" },
      { name: "Ana Nova" },
    );
    expect(patch).toEqual({ name: "Ana Nova" });
  });
});

describe("findExistingContact", () => {
  // Minimal SupabaseClient stub: resolves the .from().select().eq().like()
  // chain to a fixed candidate set.
  function stubDb(rows: Array<{ id: string; phone: string }>): SupabaseClient {
    const builder = {
      select: () => builder,
      eq: () => builder,
      like: () => Promise.resolve({ data: rows, error: null }),
    };
    return { from: () => builder } as unknown as SupabaseClient;
  }

  it("returns a trunk-variant match via phonesMatch", async () => {
    const db = stubDb([{ id: "c1", phone: "37063949836" }]);
    const hit = await findExistingContact(db, "acct", "+370 063 949 836");
    expect(hit?.id).toBe("c1");
  });

  it("returns null when no candidate matches", async () => {
    const db = stubDb([{ id: "c1", phone: "15559999999" }]);
    const hit = await findExistingContact(db, "acct", "+1 555-123-4567");
    expect(hit).toBeNull();
  });

  it("returns null for an empty phone without querying", async () => {
    const db = stubDb([{ id: "c1", phone: "15551234567" }]);
    expect(await findExistingContact(db, "acct", "   ")).toBeNull();
  });
});

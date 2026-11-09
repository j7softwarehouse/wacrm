import { describe, it, expect } from "vitest";
import { canonicalPhoneKey, dedupeByPhoneKey } from "./phone-key";

describe("canonicalPhoneKey", () => {
  it("trata as formas do mesmo número como uma chave só", () => {
    const forms = [
      "31 98640-5178",
      "553186405178",
      "+5531986405178",
      "31986405178",
      "3186405178",
    ];
    for (const f of forms) expect(canonicalPhoneKey(f)).toBe("3186405178");
  });

  it("diferencia DDD diferente", () => {
    expect(canonicalPhoneKey("31 98640-5178")).not.toBe(canonicalPhoneKey("11 98640-5178"));
  });

  it("devolve null para vazio", () => {
    expect(canonicalPhoneKey(null)).toBeNull();
    expect(canonicalPhoneKey("")).toBeNull();
    expect(canonicalPhoneKey("   ")).toBeNull();
  });

  it("número fora do padrão mantém os dígitos", () => {
    expect(canonicalPhoneKey("5521993588304")).toBe("2193588304"); // DDD 21 + últimos 8
    expect(canonicalPhoneKey("12345")).toBe("12345");
  });
});

describe("dedupeByPhoneKey", () => {
  it("mantém o primeiro de cada chave, na ordem recebida", () => {
    const list = [
      { id: "a", phone: "31 98640-5178" },
      { id: "b", phone: "553186405178" },
      { id: "c", phone: "31 99999-0000" },
    ];
    expect(dedupeByPhoneKey(list).map((x) => x.id)).toEqual(["a", "c"]);
  });

  it("mantém itens sem telefone", () => {
    const list = [{ id: "a", phone: null }, { id: "b", phone: null }];
    expect(dedupeByPhoneKey(list)).toHaveLength(2);
  });
});

import { formatContactPhone } from "./phone-key";

describe("formatContactPhone", () => {
  it("celular com 9 dígitos: mantém o 9", () => {
    const forms = ["31 98640-5178", "5531986405178", "+55 31 98640-5178", "31986405178"];
    for (const f of forms) expect(formatContactPhone(f)).toBe("+55 31 98640-5178");
  });

  it("celular antigo (8 dígitos começando com 6 a 9): recebe o 9", () => {
    expect(formatContactPhone("553186405178")).toBe("+55 31 98640-5178");
    expect(formatContactPhone("31 8640-5178")).toBe("+55 31 98640-5178");
  });

  it("fixo (8 dígitos começando com 2 a 5): sem 9", () => {
    expect(formatContactPhone("553133334444")).toBe("+55 31 3333-4444");
    expect(formatContactPhone("31 3333-4444")).toBe("+55 31 3333-4444");
  });

  it("o mesmo número em formatos diferentes gera o mesmo texto salvo", () => {
    expect(formatContactPhone("553186405178")).toBe(formatContactPhone("31 98640-5178"));
  });

  it("devolve o original quando não é um número brasileiro reconhecível", () => {
    expect(formatContactPhone("12345")).toBe("12345");
    expect(formatContactPhone("")).toBe("");
    expect(formatContactPhone(null)).toBe("");
  });
});

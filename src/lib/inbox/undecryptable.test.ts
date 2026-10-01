import { describe, expect, it } from "vitest";
import { isUndecryptablePlaceholder } from "./undecryptable";

describe("isUndecryptablePlaceholder", () => {
  it("reconhece o texto real gravado pela uazapi", () => {
    expect(
      isUndecryptablePlaceholder(
        "[Undecryptable] [media] [image] Não foi possível descriptografar a mensagem. Abra o WhatsApp no seu celular para visualizá-la.",
      ),
    ).toBe(true);
  });

  it("não reconhece uma mensagem de texto comum", () => {
    expect(isUndecryptablePlaceholder("Bom dia, tudo bem?")).toBe(false);
  });

  it("não reconhece undefined/null/vazio", () => {
    expect(isUndecryptablePlaceholder(undefined)).toBe(false);
    expect(isUndecryptablePlaceholder(null)).toBe(false);
    expect(isUndecryptablePlaceholder("")).toBe(false);
  });

  it("é insensível a maiúsculas/minúsculas no prefixo", () => {
    expect(isUndecryptablePlaceholder("[undecryptable] algo")).toBe(true);
  });
});

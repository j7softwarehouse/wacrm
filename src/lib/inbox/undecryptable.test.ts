import { describe, expect, it } from "vitest";
import {
  canRequestMessageRecovery,
  isUndecryptablePlaceholder,
  recoveryErrorKey,
} from "./undecryptable";

const PLACEHOLDER =
  "[Undecryptable] [media] [image] Não foi possível descriptografar a mensagem.";

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

describe("canRequestMessageRecovery", () => {
  const base = {
    role: "admin" as const,
    senderType: "customer",
    contentText: PLACEHOLDER,
    deletedAt: null,
  };

  it("admin e owner veem o botão numa mensagem do cliente com placeholder", () => {
    expect(canRequestMessageRecovery({ ...base, role: "admin" })).toBe(true);
    expect(canRequestMessageRecovery({ ...base, role: "owner" })).toBe(true);
  });

  it("agent e viewer não veem o botão, mesmo com placeholder", () => {
    expect(canRequestMessageRecovery({ ...base, role: "agent" })).toBe(false);
    expect(canRequestMessageRecovery({ ...base, role: "viewer" })).toBe(false);
  });

  it("papel nulo (perfil ainda carregando) não vê o botão", () => {
    expect(canRequestMessageRecovery({ ...base, role: null })).toBe(false);
  });

  it("só vale para mensagem recebida do cliente", () => {
    expect(canRequestMessageRecovery({ ...base, senderType: "agent" })).toBe(false);
    expect(canRequestMessageRecovery({ ...base, senderType: "bot" })).toBe(false);
  });

  it("só vale para texto que é placeholder", () => {
    expect(canRequestMessageRecovery({ ...base, contentText: "Bom dia" })).toBe(false);
    expect(canRequestMessageRecovery({ ...base, contentText: null })).toBe(false);
  });

  it("não oferece recuperação em mensagem apagada", () => {
    expect(
      canRequestMessageRecovery({ ...base, deletedAt: "2026-11-01T10:00:00Z" }),
    ).toBe(false);
  });
});

describe("recoveryErrorKey", () => {
  it("403 vira 'forbidden' (só admin pode pedir)", () => {
    expect(recoveryErrorKey(403)).toBe("forbidden");
  });

  it("400 com code no_anchor vira 'noAnchor'", () => {
    expect(recoveryErrorKey(400, "no_anchor")).toBe("noAnchor");
  });

  it("400 sem code específico, 502 e 500 caem em 'failed' (texto sem fornecedor)", () => {
    expect(recoveryErrorKey(400)).toBe("failed");
    expect(recoveryErrorKey(400, "outro")).toBe("failed");
    expect(recoveryErrorKey(502)).toBe("failed");
    expect(recoveryErrorKey(500)).toBe("failed");
  });
});

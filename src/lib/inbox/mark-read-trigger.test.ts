import { describe, expect, it } from "vitest";
import { MARK_READ_DWELL_MS, MARK_READ_DEBOUNCE_MS, isMarkReadEligible } from "./mark-read-trigger";

// Quando o CRM pode avisar o WhatsApp que a mensagem foi lida: só canal
// uazapi, só conversa individual (grupo fica de fora por ora) e só quem
// pode responder (viewer nunca dispara).
describe("isMarkReadEligible", () => {
  const base = {
    conversationId: "conv-1",
    channelProvider: "uazapi" as const,
    isGroup: false,
    canSendMessages: true,
  };

  it("elegível: uazapi, conversa individual, atendente", () => {
    expect(isMarkReadEligible(base)).toBe(true);
  });

  it("não elegível sem conversa aberta", () => {
    expect(isMarkReadEligible({ ...base, conversationId: undefined })).toBe(false);
  });

  it("não elegível no canal Meta", () => {
    expect(isMarkReadEligible({ ...base, channelProvider: "meta" })).toBe(false);
  });

  it("não elegível em grupo", () => {
    expect(isMarkReadEligible({ ...base, isGroup: true })).toBe(false);
  });

  it("não elegível para quem não pode responder (viewer)", () => {
    expect(isMarkReadEligible({ ...base, canSendMessages: false })).toBe(false);
  });
});

describe("tempos", () => {
  // 2s: tempo mínimo olhando a conversa antes do primeiro aviso — passar
  // o olho rápido pela lista não pode acender o azul pro contato.
  it("dwell é de 2s e o debounce de rajada é mais curto que ele", () => {
    expect(MARK_READ_DWELL_MS).toBe(2000);
    expect(MARK_READ_DEBOUNCE_MS).toBeLessThan(MARK_READ_DWELL_MS);
  });
});

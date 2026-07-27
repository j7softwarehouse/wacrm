import { describe, expect, it } from "vitest";
import type { InboundContent } from "./ingest";
import { buildConversationPreview, isDuplicateMessage } from "./ingest";

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

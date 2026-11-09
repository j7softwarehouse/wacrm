import { describe, it, expect } from "vitest";
import { unreadCountSinceLastReply } from "./mark-unread";

const m = (sender_type: string, created_at: string) => ({ sender_type, created_at });

describe("unreadCountSinceLastReply", () => {
  it("conta as mensagens do cliente depois da última resposta da equipe", () => {
    const msgs = [
      m("customer", "2026-11-05T10:00:00Z"),
      m("agent", "2026-11-05T11:00:00Z"),
      m("customer", "2026-11-06T09:00:00Z"),
      m("customer", "2026-11-06T09:05:00Z"),
      m("customer", "2026-11-06T09:10:00Z"),
    ];
    expect(unreadCountSinceLastReply(msgs)).toBe(3);
  });

  it("mínimo de 1 quando a última mensagem é da equipe", () => {
    const msgs = [m("customer", "2026-11-05T10:00:00Z"), m("agent", "2026-11-05T11:00:00Z")];
    expect(unreadCountSinceLastReply(msgs)).toBe(1);
  });

  it("mínimo de 1 quando não há nenhuma mensagem", () => {
    expect(unreadCountSinceLastReply([])).toBe(1);
  });

  it("ordena pela data antes de contar (entrada fora de ordem)", () => {
    const msgs = [
      m("customer", "2026-11-06T09:10:00Z"),
      m("agent", "2026-11-06T09:00:00Z"),
      m("customer", "2026-11-06T09:05:00Z"),
    ];
    expect(unreadCountSinceLastReply(msgs)).toBe(2);
  });
});

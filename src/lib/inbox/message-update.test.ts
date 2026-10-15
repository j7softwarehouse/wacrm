import { describe, expect, it } from "vitest";
import type { Message } from "@/types";
import { applyMessageUpdate } from "./message-update";

function msg(overrides: Partial<Message>): Message {
  return {
    id: "m1",
    conversation_id: "conv-1",
    sender_type: "agent",
    content_type: "text",
    status: "sent",
    created_at: "2026-10-15T10:00:00.000Z",
    ...overrides,
  };
}

// A Inbox escuta UPDATE de TODAS as mensagens da conta (tiques de
// entrega, leitura, edição — de qualquer conversa e de qualquer
// atendente). Antes, cada evento criava um array novo mesmo sem mudar
// nada, e o efeito de rolagem da conversa aberta puxava a tela para o
// fim a cada um — arrancando quem lia o histórico (relato do Paulo,
// 15/10/2026). Identidade do array = "nada mudou".
describe("applyMessageUpdate", () => {
  it("devolve o MESMO array quando a mensagem não está na conversa aberta", () => {
    const prev = [msg({ id: "m1" }), msg({ id: "m2" })];
    expect(applyMessageUpdate(prev, msg({ id: "outra-conversa", status: "read" }))).toBe(prev);
  });

  it("devolve o MESMO array quando o evento não muda nenhum campo", () => {
    const prev = [msg({ id: "m1", status: "delivered" })];
    expect(applyMessageUpdate(prev, msg({ id: "m1", status: "delivered" }))).toBe(prev);
  });

  it("atualiza só a mensagem alvo quando algum campo mudou, preservando as outras", () => {
    const m1 = msg({ id: "m1", status: "sent" });
    const m2 = msg({ id: "m2", status: "sent" });
    const prev = [m1, m2];

    const next = applyMessageUpdate(prev, msg({ id: "m1", status: "read" }));

    expect(next).not.toBe(prev);
    expect(next[0].status).toBe("read");
    expect(next[1]).toBe(m2);
  });

  it("mescla campos parciais do evento sem apagar os que o evento não trouxe", () => {
    const prev = [msg({ id: "m1", content_text: "olá", status: "sent" })];
    const partial = { id: "m1", status: "delivered" } as Message;

    const next = applyMessageUpdate(prev, partial);

    expect(next[0].content_text).toBe("olá");
    expect(next[0].status).toBe("delivered");
  });
});

import { describe, expect, it } from "vitest";
import { pickMessageIdsToMarkRead } from "./mark-read";

// Quais mensagens recebidas, já exibidas na tela, ainda precisam do
// aviso "lido" pro WhatsApp. Pedido do usuário (20/10/2026): o CRM
// nunca manda /message/markread, então o pai nunca vê o azul enquanto
// não responder pelo celular da escola — mesmo que a secretaria já
// tenha aberto e lido no CRM.
function msg(overrides: Partial<Parameters<typeof pickMessageIdsToMarkRead>[0][number]>) {
  return {
    id: "row-1",
    message_id: "WAMID-1",
    sender_type: "customer" as const,
    status: "delivered" as const,
    ...overrides,
  };
}

describe("pickMessageIdsToMarkRead", () => {
  it("inclui mensagem do cliente ainda não lida", () => {
    const out = pickMessageIdsToMarkRead([msg({})]);
    expect(out).toEqual(["WAMID-1"]);
  });

  it("ignora mensagem já lida (idempotente — nada a fazer de novo)", () => {
    const out = pickMessageIdsToMarkRead([msg({ status: "read" })]);
    expect(out).toEqual([]);
  });

  it("ignora mensagem enviada pelo atendente/bot — só o cliente gera leitura pendente", () => {
    const out = pickMessageIdsToMarkRead([
      msg({ sender_type: "agent", status: "delivered" }),
      msg({ sender_type: "bot", status: "delivered" }),
    ]);
    expect(out).toEqual([]);
  });

  it("ignora mensagem sem message_id (nunca confirmada pelo WhatsApp, nada pra marcar)", () => {
    const out = pickMessageIdsToMarkRead([msg({ message_id: null })]);
    expect(out).toEqual([]);
  });

  it("pega só as pendentes de uma lista mista, na ordem original", () => {
    const out = pickMessageIdsToMarkRead([
      msg({ message_id: "A", status: "read" }),
      msg({ message_id: "B", status: "delivered" }),
      msg({ message_id: "C", sender_type: "agent" }),
      msg({ message_id: "D", status: "delivered" }),
    ]);
    expect(out).toEqual(["B", "D"]);
  });
});

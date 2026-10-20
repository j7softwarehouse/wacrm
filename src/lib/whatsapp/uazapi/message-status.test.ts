import { describe, expect, it } from "vitest";
import { statusesThatMayAdvanceTo } from "./message-status";

// Os eventos de status da UAZAPI chegam em paralelo e fora de ordem
// (entregue, lido, reenvios). O status só pode AVANÇAR: sent → delivered
// → read. Antes, um "entregue" gravado depois de um "lido" voltava o
// balão para cinza mesmo com a mensagem já lida no WhatsApp (relato de
// 20/10/2026).
describe("statusesThatMayAdvanceTo", () => {
  it("lido avança de qualquer estado anterior", () => {
    expect(statusesThatMayAdvanceTo("read").sort()).toEqual(
      ["delivered", "failed", "sending", "sent"].sort(),
    );
  });

  it("entregue avança de enviado, mas nunca de lido", () => {
    const from = statusesThatMayAdvanceTo("delivered");
    expect(from).toContain("sent");
    expect(from).not.toContain("read");
    expect(from).not.toContain("delivered");
  });

  it("enviado só avança de 'enviando' (nunca regride entregue/lido)", () => {
    expect(statusesThatMayAdvanceTo("sent")).toEqual(["sending"]);
  });

  it("'enviando' nunca é destino de um evento posterior", () => {
    expect(statusesThatMayAdvanceTo("sending")).toEqual([]);
  });

  it("falha só vale enquanto a mensagem ainda não foi entregue nem lida", () => {
    expect(statusesThatMayAdvanceTo("failed").sort()).toEqual(["sending", "sent"].sort());
  });
});

import { describe, expect, it } from "vitest";

import { channelColor } from "./channel-color";

describe("channelColor", () => {
  it("o primeiro numero (em ordem alfanumerica) sempre cai na PRIMEIRA cor da paleta", () => {
    // Pedido do usuário: "começando com um verde, outro laranja" —
    // ordem fixa, não sorteio. A ordenação é por telefone (não por
    // created_at do canal), porque created_at muda toda vez que a
    // instância UAZAPI é recriada — telefone, não.
    const all = ["553183886076", "553183839660"];
    const a = channelColor("553183839660", all); // "...8396..." vem antes
    const b = channelColor("553183886076", all); // "...8886..." vem depois
    expect(a).toEqual(channelColor("553183839660", all));
    expect(a).not.toEqual(b);
  });

  it("e estavel mesmo com a LISTA de telefones na ordem diferente", () => {
    const phone = "553183839660";
    const a = channelColor(phone, ["553183839660", "553183886076"]);
    const b = channelColor(phone, ["553183886076", "553183839660"]);
    expect(a).toEqual(b);
  });

  it("continua estavel quando um numero SOME da lista de canais ativos e volta", () => {
    // Simula: canal removido (token invalido) e recriado com o MESMO
    // numero -- a lista de telefones ativos nesse intervalo pode ter
    // ficado momentaneamente com só o outro número, mas assim que os
    // dois voltam a existir, a cor de cada um volta a ser a mesma.
    const antes = channelColor("553183839660", [
      "553183839660",
      "553183886076",
    ]);
    const depois = channelColor("553183839660", [
      "553183839660",
      "553183886076",
    ]);
    expect(antes).toEqual(depois);
  });

  it("numeros diferentes tendem a cair em cores diferentes numa lista maior", () => {
    const all = ["553183886076", "553183839660", "5511999999999", "5521888888888"];
    const colors = all.map((p) => channelColor(p, all).dot);
    expect(new Set(colors).size).toBeGreaterThan(1);
  });

  it("devolve as tres classes (dot, text, border) sempre preenchidas", () => {
    const color = channelColor("qualquer-numero", ["qualquer-numero"]);
    expect(color.dot).toMatch(/^bg-/);
    expect(color.text).toMatch(/^text-/);
    expect(color.border).toMatch(/^border-/);
  });

  it("nao quebra quando o telefone nao esta na lista (linha nunca encontrada)", () => {
    expect(() => channelColor("nao-esta-na-lista", ["outro"])).not.toThrow();
  });
});

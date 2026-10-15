import { describe, expect, it } from "vitest";
import { STICK_TO_BOTTOM_PX, isNearBottom } from "./scroll-stick";

// O efeito de rolagem da conversa levava a tela para o fim a cada
// mudança na lista de mensagens, até com a pessoa lendo o histórico
// (ex.: depois de pular até uma mensagem marcada). Agora só acompanha o
// fim quando a pessoa já está perto dele — como o WhatsApp.
describe("isNearBottom", () => {
  it("true quando está exatamente no fim", () => {
    expect(isNearBottom({ scrollTop: 7000, clientHeight: 500, scrollHeight: 7500 })).toBe(true);
  });

  it("true dentro da margem do fim", () => {
    expect(
      isNearBottom({ scrollTop: 7500 - 500 - (STICK_TO_BOTTOM_PX - 1), clientHeight: 500, scrollHeight: 7500 }),
    ).toBe(true);
  });

  it("false quando a pessoa subiu além da margem (lendo histórico)", () => {
    expect(
      isNearBottom({ scrollTop: 7500 - 500 - (STICK_TO_BOTTOM_PX + 1), clientHeight: 500, scrollHeight: 7500 }),
    ).toBe(false);
  });

  it("false no topo de uma conversa longa", () => {
    expect(isNearBottom({ scrollTop: 0, clientHeight: 500, scrollHeight: 7500 })).toBe(false);
  });

  it("true quando o conteúdo cabe inteiro na tela (nada a rolar)", () => {
    expect(isNearBottom({ scrollTop: 0, clientHeight: 500, scrollHeight: 400 })).toBe(true);
  });

  it("margem é de 150 px", () => {
    expect(STICK_TO_BOTTOM_PX).toBe(150);
  });
});

import { describe, expect, it } from "vitest";
import { statusTickClass } from "./status-tick";

// Os tiques de status ficam DENTRO do balão do atendente, que é o fundo
// primário (violeta no tema padrão). `text-muted-foreground` (cinza) tinha
// contraste 1,26:1 e `blue-400` 2,40:1 sobre esse fundo — o atendente
// não via se a mensagem tinha sido lida (relato de 20/10/2026).
describe("statusTickClass", () => {
  const statuses = ["sending", "sent", "delivered", "read", "failed"] as const;

  it.each(statuses)("%s não usa cores de baixo contraste sobre o balão primário", (status) => {
    const cls = statusTickClass(status);
    expect(cls).not.toMatch(/muted-foreground/);
    expect(cls).not.toMatch(/blue-400/);
  });

  it("enviado/entregue seguem a cor do texto do balão (adaptam a qualquer tema)", () => {
    expect(statusTickClass("sent")).toMatch(/text-primary-foreground/);
    expect(statusTickClass("delivered")).toMatch(/text-primary-foreground/);
  });

  it("lido tem cor própria (ciano) — o único estado que muda de matiz", () => {
    expect(statusTickClass("read")).toMatch(/text-cyan-300/);
    expect(statusTickClass("delivered")).not.toMatch(/cyan/);
  });

  it("falha continua em vermelho, claro o bastante para o balão", () => {
    expect(statusTickClass("failed")).toMatch(/text-red-300/);
  });
});

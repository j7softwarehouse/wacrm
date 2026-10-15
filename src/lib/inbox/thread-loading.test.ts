import { describe, expect, it } from "vitest";
import { shouldShowThreadSpinner } from "./thread-loading";

// Recarregar a conversa (conexão do tempo real que cai e volta, botão de
// atualizar, aba que ficou muito tempo escondida) trocava a lista por um
// spinner: a área rolável perdia altura e a pessoa perdia o ponto onde
// estava lendo (relato do Paulo, 15/10/2026). Spinner só na PRIMEIRA
// carga de cada conversa; recarga da mesma conversa é silenciosa.
describe("shouldShowThreadSpinner", () => {
  it("mostra o spinner ao abrir uma conversa pela primeira vez", () => {
    expect(shouldShowThreadSpinner(null, "conv-1")).toBe(true);
  });

  it("mostra o spinner ao trocar para outra conversa", () => {
    expect(shouldShowThreadSpinner("conv-1", "conv-2")).toBe(true);
  });

  it("NÃO mostra o spinner ao recarregar a mesma conversa já carregada", () => {
    expect(shouldShowThreadSpinner("conv-1", "conv-1")).toBe(false);
  });
});

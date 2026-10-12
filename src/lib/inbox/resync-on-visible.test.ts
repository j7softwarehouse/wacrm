import { describe, expect, it } from "vitest";

import { RESYNC_AFTER_HIDDEN_MS, shouldResyncOnVisible } from "./resync-on-visible";

// Cada recarga da Inbox baixa a lista de conversas inteira (~1,1 MB).
// Recarregar a CADA volta à aba multiplicava isso pelo vai e vem entre
// WhatsApp e CRM o dia todo. Aba escondida por pouco tempo continua
// recebendo o tempo real normalmente; só vale recarregar depois de
// tempo suficiente para o navegador ter estrangulado a aba.

const T0 = 1_000_000;

describe("shouldResyncOnVisible", () => {
  it("não recarrega se a aba ficou escondida menos de 5 minutos", () => {
    expect(shouldResyncOnVisible(T0, T0 + RESYNC_AFTER_HIDDEN_MS - 1)).toBe(false);
  });

  it("recarrega se a aba ficou escondida 5 minutos ou mais", () => {
    expect(shouldResyncOnVisible(T0, T0 + RESYNC_AFTER_HIDDEN_MS)).toBe(true);
  });

  it("não recarrega sem registro de quando a aba foi escondida", () => {
    expect(shouldResyncOnVisible(null, T0)).toBe(false);
  });

  it("limite é de 5 minutos", () => {
    expect(RESYNC_AFTER_HIDDEN_MS).toBe(5 * 60_000);
  });
});

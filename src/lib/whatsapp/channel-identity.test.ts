import { describe, expect, it } from "vitest";

import { resolveChannelPhone } from "./channel-identity";

describe("resolveChannelPhone", () => {
  const phoneByChannelId = new Map([
    ["chan-a", "553183886076"],
    ["chan-b", "553183839660"],
  ]);

  it("resolve pelo telefone do proprio canal quando channel_id existe", () => {
    expect(resolveChannelPhone("chan-a", phoneByChannelId, "chan-b")).toBe(
      "553183886076",
    );
  });

  it("cai no canal padrao da conta quando channel_id e nulo", () => {
    // Conversa orfa (canal antigo apagado) -- usa o telefone do canal
    // padrao da conta, nao fica bloqueada pra sempre.
    expect(resolveChannelPhone(null, phoneByChannelId, "chan-b")).toBe(
      "553183839660",
    );
  });

  it("duas instancias diferentes do MESMO numero resolvem pro mesmo telefone", () => {
    // O ponto central da regra: recriar a instancia uazapi troca o
    // channel_id, mas o numero do cliente continua o mesmo -- duas
    // conversas em channel_id diferentes devem bater se os dois canais
    // tem o mesmo phone_e164.
    const reinstanced = new Map([
      ["chan-old", "553183886076"],
      ["chan-new", "553183886076"],
    ]);
    const a = resolveChannelPhone("chan-old", reinstanced, "chan-new");
    const b = resolveChannelPhone("chan-new", reinstanced, "chan-new");
    expect(a).toBe(b);
  });

  it("devolve null quando nao ha canal nenhum pra resolver (conta sem canal)", () => {
    expect(resolveChannelPhone(null, new Map(), null)).toBeNull();
  });

  it("devolve null quando o channel_id (proprio ou padrao) nao esta no mapa (canal removido de vez)", () => {
    expect(resolveChannelPhone("chan-apagado", phoneByChannelId, "chan-b")).toBeNull();
  });
});

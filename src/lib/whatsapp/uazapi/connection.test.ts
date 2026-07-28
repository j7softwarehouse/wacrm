import { describe, expect, it } from "vitest";
import { buildWebhookConfig, mapInstanceStatus, phoneFromJid } from "./connection";

describe("mapInstanceStatus", () => {
  it("mapeia os quatro estados documentados", () => {
    expect(mapInstanceStatus("connected")).toBe("connected");
    expect(mapInstanceStatus("connecting")).toBe("connecting");
    expect(mapInstanceStatus("disconnected")).toBe("disconnected");
    expect(mapInstanceStatus("hibernated")).toBe("hibernated");
  });

  it("trata estado desconhecido como desconectado", () => {
    // Falhar fechado: um status que não entendemos não pode virar
    // "conectado", ou o CRM tentaria enviar por um canal morto.
    expect(mapInstanceStatus("algo_novo")).toBe("disconnected");
    expect(mapInstanceStatus(undefined)).toBe("disconnected");
  });
});

describe("phoneFromJid", () => {
  it("extrai o número do JID de usuário", () => {
    expect(phoneFromJid("5511999999999@s.whatsapp.net")).toBe("5511999999999");
  });

  it("descarta o sufixo de dispositivo", () => {
    expect(phoneFromJid("5511999999999:12@s.whatsapp.net")).toBe("5511999999999");
  });

  it("devolve null para jid ausente", () => {
    expect(phoneFromJid(null)).toBeNull();
    expect(phoneFromJid(undefined)).toBeNull();
    expect(phoneFromJid("")).toBeNull();
  });
});

describe("buildWebhookConfig", () => {
  const config = buildWebhookConfig("https://crm.exemplo.com/api/whatsapp/uazapi/webhook/SEGREDO");

  it("assina apenas os três eventos que o CRM consome", () => {
    expect(config.events).toEqual(["messages", "messages_update", "connection"]);
  });

  it("exclui o eco das próprias mensagens", () => {
    // Sem wasSentByApi, toda mensagem enviada pelo CRM volta como
    // evento e é inserida de novo, duplicando o histórico.
    expect(config.excludeMessages).toContain("wasSentByApi");
  });

  it("exclui grupos com isGroupYes, não isGroupNo", () => {
    // Cuidado: na UAZAPI isGroupNo remove conversas INDIVIDUAIS.
    // Trocar os dois faria o CRM descartar tudo que interessa.
    expect(config.excludeMessages).toContain("isGroupYes");
    expect(config.excludeMessages).not.toContain("isGroupNo");
  });

  it("desliga os parâmetros de URL — eles quebrariam o roteamento", () => {
    // Quando ativos, a UAZAPI acrescenta segmentos ao caminho, e o
    // segredo de roteamento vive justamente no caminho.
    expect(config.addUrlEvents).toBe(false);
    expect(config.addUrlTypesMessages).toBe(false);
  });
});

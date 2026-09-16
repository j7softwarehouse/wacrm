import { describe, expect, it } from "vitest";
import {
  buildWebhookConfig,
  mapInstanceStatus,
  mapUazapiMessageStatus,
  phoneFromJid,
} from "./connection";

describe("mapUazapiMessageStatus", () => {
  it("traduz o vocabulário da UAZAPI para os cinco valores do CHECK da 001", () => {
    // `messages.status` tem CHECK IN ('sending','sent','delivered','read',
    // 'failed'). Gravar o valor cru violava a constraint — e como o
    // webhook não conferia o erro do UPDATE, nenhum status avançava e
    // ninguém percebia.
    expect(mapUazapiMessageStatus("DELIVERY_ACK")).toBe("delivered");
    expect(mapUazapiMessageStatus("SERVER_ACK")).toBe("sent");
    expect(mapUazapiMessageStatus("PLAYED")).toBe("read");
    expect(mapUazapiMessageStatus("READ")).toBe("read");
    expect(mapUazapiMessageStatus("PENDING")).toBe("sending");
    expect(mapUazapiMessageStatus("ERROR")).toBe("failed");
  });

  it("aceita os próprios valores do CRM (o webhook às vezes ecoa)", () => {
    for (const s of ["sending", "sent", "delivered", "read", "failed"]) {
      expect(mapUazapiMessageStatus(s)).toBe(s);
    }
  });

  it("devolve null para o desconhecido em vez de arriscar a constraint", () => {
    expect(mapUazapiMessageStatus("SOMETHING_NEW")).toBeNull();
    expect(mapUazapiMessageStatus("")).toBeNull();
    expect(mapUazapiMessageStatus(null)).toBeNull();
    expect(mapUazapiMessageStatus(undefined)).toBeNull();
  });
});

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

  it("nao exclui mais grupos, mas segue excluindo eco de envio", () => {
    // CUIDADO: na UAZAPI `isGroupNo` remove conversas INDIVIDUAIS.
    // Nenhum dos dois deve aparecer — grupo agora entra, e o 1:1
    // nunca pode ser filtrado.
    expect(config.excludeMessages).not.toContain("isGroupYes");
    expect(config.excludeMessages).not.toContain("isGroupNo");
    expect(config.excludeMessages).toContain("wasSentByApi");
  });

  it("desliga os parâmetros de URL — eles quebrariam o roteamento", () => {
    // Quando ativos, a UAZAPI acrescenta segmentos ao caminho, e o
    // segredo de roteamento vive justamente no caminho.
    expect(config.addUrlEvents).toBe(false);
    expect(config.addUrlTypesMessages).toBe(false);
  });

  it("habilita o webhook explicitamente", () => {
    // Sem isso a UAZAPI cria o webhook desabilitado por padrão — o
    // registro parece bem-sucedido (POST /webhook responde OK,
    // webhook_registered_at é carimbado) mas nada chega. Só
    // descoberto testando contra uma instância real.
    expect(config.enabled).toBe(true);
  });
});

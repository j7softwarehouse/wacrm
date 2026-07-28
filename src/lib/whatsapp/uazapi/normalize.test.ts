import { describe, expect, it } from "vitest";
import { normalizeUazapiEvent } from "./normalize";

const eventoTexto = {
  event: "message",
  instance: "inst-1",
  data: {
    messageid: "3EB0ABC",
    chatid: "5511888888888@s.whatsapp.net",
    sender: "5511888888888@s.whatsapp.net",
    senderName: "Maria",
    isGroup: false,
    fromMe: false,
    messageType: "conversation",
    messageTimestamp: 1700000000,
    text: "bom dia",
    wasSentByApi: false,
  },
};

describe("normalizeUazapiEvent", () => {
  it("extrai remetente, nome, id e texto", () => {
    const result = normalizeUazapiEvent(eventoTexto);
    expect(result).not.toBeNull();
    expect(result!.from).toBe("5511888888888");
    expect(result!.pushName).toBe("Maria");
    expect(result!.providerMessageId).toBe("3EB0ABC");
    expect(result!.timestamp).toBe(1700000000);
    expect(result!.content).toEqual({ type: "text", text: "bom dia" });
  });

  it("descarta mensagens de grupo", () => {
    // O CRM não tem conceito de grupo; sem este filtro cada grupo
    // viraria um "contato" com o JID no lugar do telefone.
    const grupo = { ...eventoTexto, data: { ...eventoTexto.data, isGroup: true } };
    expect(normalizeUazapiEvent(grupo)).toBeNull();
  });

  it("descarta o eco das próprias mensagens", () => {
    // Redundante com o filtro wasSentByApi da assinatura, de propósito:
    // se alguém reconfigurar o webhook no painel da UAZAPI, o histórico
    // não duplica.
    const eco = { ...eventoTexto, data: { ...eventoTexto.data, wasSentByApi: true } };
    expect(normalizeUazapiEvent(eco)).toBeNull();

    const meu = { ...eventoTexto, data: { ...eventoTexto.data, fromMe: true } };
    expect(normalizeUazapiEvent(meu)).toBeNull();
  });

  it("descarta evento que não é de mensagem", () => {
    expect(normalizeUazapiEvent({ event: "connection", instance: "i", data: {} })).toBeNull();
  });

  it("aceita a forma alternativa documentada no SSE", () => {
    // A doc do SSE usa `from` e `timestamp`; o schema Message usa
    // `sender` e `messageTimestamp`. Aceitar as duas evita depender de
    // qual delas o servidor realmente envia.
    const alternativo = {
      event: "message",
      instance: "inst-1",
      data: {
        id: "3EB0XYZ",
        from: "5511777777777@s.whatsapp.net",
        text: "oi",
        timestamp: 1700000001,
      },
    };
    const result = normalizeUazapiEvent(alternativo);
    expect(result!.from).toBe("5511777777777");
    expect(result!.providerMessageId).toBe("3EB0XYZ");
  });

  it("reconhece mídia pelo fileURL", () => {
    const imagem = {
      ...eventoTexto,
      data: {
        ...eventoTexto.data,
        messageType: "imageMessage",
        text: "olha isso",
        fileURL: "https://mmg.whatsapp.net/abc",
      },
    };
    const result = normalizeUazapiEvent(imagem);
    expect(result!.content.type).toBe("image");
    expect(result!.content.mediaUrl).toBe("https://mmg.whatsapp.net/abc");
    expect(result!.content.text).toBe("olha isso");
  });

  it("guarda o botão tocado como resposta interativa", () => {
    const toque = {
      ...eventoTexto,
      data: { ...eventoTexto.data, buttonOrListid: "Sim" },
    };
    const result = normalizeUazapiEvent(toque);
    expect(result!.content.interactiveReplyId).toBe("Sim");
  });

  it("devolve null em payload malformado sem lançar", () => {
    // Webhook não pode responder 500 por payload estranho: o provedor
    // reentrega em loop.
    expect(normalizeUazapiEvent(null)).toBeNull();
    expect(normalizeUazapiEvent({})).toBeNull();
    expect(normalizeUazapiEvent({ event: "message", data: {} })).toBeNull();
  });
});

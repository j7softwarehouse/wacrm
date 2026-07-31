import { describe, expect, it } from "vitest";
import { normalizeUazapiEvent } from "./normalize";

// Capturado de uma entrega real em produção (2026-07-29) — a doc da
// UAZAPI nunca bateu com isso (ver comentário no topo de normalize.ts).
// `EventType`/`message`, não `event`/`data`; `sender` é um @lid opaco,
// não o telefone; `messageTimestamp` vem em milissegundos.
const eventoReal = {
  BaseUrl: "https://exemplo.uazapi.com",
  EventType: "messages",
  chat: { id: "chat-1", name: "Contato" },
  chatSource: "updated",
  instanceName: "inst-1",
  owner: "5511888888888",
  token: "tok",
  message: {
    buttonOrListid: "",
    chatid: "5511888888888@s.whatsapp.net",
    chatlid: "192268724080890@lid",
    content: "bom dia",
    fromMe: false,
    id: "5511888888888:3EB0ABC",
    isGroup: false,
    mediaType: "",
    messageTimestamp: 1785287848000,
    messageType: "Conversation",
    messageid: "3EB0ABC",
    quoted: "",
    sender: "192268724080890@lid",
    senderName: "Maria",
    sender_pn: "5511888888888@s.whatsapp.net",
    source: "android",
    text: "bom dia",
    wasSentByApi: false,
  },
};

// Formato antigo, nunca confirmado com evento real — mantido como
// fallback (ver extractEventType/extractMessageData) e testado por
// segurança, não porque a UAZAPI realmente o envie.
const eventoLegado = {
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

describe("normalizeUazapiEvent — formato real (EventType/message)", () => {
  it("extrai remetente pelo sender_pn, nome, id e texto", () => {
    const result = normalizeUazapiEvent(eventoReal);
    expect(result).not.toBeNull();
    expect(result!.from).toBe("5511888888888");
    expect(result!.pushName).toBe("Maria");
    expect(result!.providerMessageId).toBe("3EB0ABC");
    expect(result!.content).toEqual({ type: "text", text: "bom dia" });
  });

  it("prioriza sender_pn sobre sender quando sender é um @lid", () => {
    // sender_pn é o JID baseado em telefone; sender sozinho pode vir
    // como @lid (identificador opaco, não-telefônico). Sem essa
    // prioridade, o contato criado teria o número do LID no lugar do
    // telefone real.
    const semSenderPn = {
      ...eventoReal,
      message: { ...eventoReal.message, sender_pn: undefined },
    };
    // Sem sender_pn, cai pra chatid (telefone real neste evento) —
    // nunca pro sender em @lid.
    expect(normalizeUazapiEvent(semSenderPn)!.from).toBe("5511888888888");
  });

  it("converte messageTimestamp de milissegundos pra segundos", () => {
    const result = normalizeUazapiEvent(eventoReal);
    expect(result!.timestamp).toBe(1785287848);
  });

  it("descarta mensagens de grupo", () => {
    const grupo = {
      ...eventoReal,
      message: { ...eventoReal.message, isGroup: true },
    };
    expect(normalizeUazapiEvent(grupo)).toBeNull();
  });

  it("descarta o eco das próprias mensagens", () => {
    const eco = {
      ...eventoReal,
      message: { ...eventoReal.message, wasSentByApi: true },
    };
    expect(normalizeUazapiEvent(eco)).toBeNull();

    const meu = {
      ...eventoReal,
      message: { ...eventoReal.message, fromMe: true },
    };
    expect(normalizeUazapiEvent(meu)).toBeNull();
  });

  it("descarta evento que não é de mensagem", () => {
    expect(
      normalizeUazapiEvent({ EventType: "connection", instanceName: "i" }),
    ).toBeNull();
  });

  it("reconhece mídia por message.content.URL/mediaKey e empacota pra descriptografia", () => {
    // Estrutura confirmada com evento real de imagem capturado em
    // 2026-07-30: `content` vira objeto (URL/mediaKey/mimetype), não a
    // string plana das mensagens de texto. `fileURL` no topo do evento
    // nunca existiu de verdade — era suposição da doc.
    const imagem = {
      ...eventoReal,
      message: {
        ...eventoReal.message,
        messageType: "ImageMessage",
        mediaType: "image",
        text: "olha isso",
        content: {
          URL: "https://mmg.whatsapp.net/abc",
          mediaKey: "chaveBase64==",
          mimetype: "image/jpeg",
        },
      },
    };
    const result = normalizeUazapiEvent(imagem);
    expect(result!.content.type).toBe("image");
    expect(result!.content.text).toBe("olha isso");
    expect(JSON.parse(result!.content.mediaUrl!)).toEqual({
      url: "https://mmg.whatsapp.net/abc",
      mediaKey: "chaveBase64==",
      mediaType: "image",
      mimetype: "image/jpeg",
    });
  });

  it("ignora mídia sem mediaKey — não há como descriptografar sem ela", () => {
    const semChave = {
      ...eventoReal,
      message: {
        ...eventoReal.message,
        messageType: "ImageMessage",
        content: { URL: "https://mmg.whatsapp.net/abc", mimetype: "image/jpeg" },
      },
    };
    const result = normalizeUazapiEvent(semChave);
    expect(result!.content.mediaUrl).toBeUndefined();
  });

  it("guarda o botão tocado como resposta interativa", () => {
    const toque = {
      ...eventoReal,
      message: { ...eventoReal.message, buttonOrListid: "Sim" },
    };
    const result = normalizeUazapiEvent(toque);
    expect(result!.content.interactiveReplyId).toBe("Sim");
  });

  it("devolve null em payload malformado sem lançar", () => {
    // Webhook não pode responder 500 por payload estranho: o provedor
    // reentrega em loop.
    expect(normalizeUazapiEvent(null)).toBeNull();
    expect(normalizeUazapiEvent({})).toBeNull();
    expect(normalizeUazapiEvent({ EventType: "messages", message: {} })).toBeNull();
  });
});

describe("normalizeUazapiEvent — formato legado (event/data), fallback", () => {
  it("ainda funciona se algum caminho de entrega usar o vocabulário antigo", () => {
    const result = normalizeUazapiEvent(eventoLegado);
    expect(result).not.toBeNull();
    expect(result!.from).toBe("5511888888888");
    expect(result!.providerMessageId).toBe("3EB0ABC");
    expect(result!.timestamp).toBe(1700000000);
  });

  it("aceita a forma alternativa com from/timestamp", () => {
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
});

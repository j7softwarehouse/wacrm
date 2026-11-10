import { describe, expect, it } from "vitest";

import { describePayloadKeys, summarizeWebhookEvent } from "./webhook-log";

describe("describePayloadKeys", () => {
  it("lista caminhos de chaves sem valores", () => {
    const keys = describePayloadKeys({
      EventType: "messages_update",
      updates: [{ key: { id: "3EB0SECRETO", fromMe: true }, status: 3 }],
    });
    expect(keys).toBe("EventType,updates,updates.0.key,updates.0.key.id,updates.0.key.fromMe,updates.0.status");
    expect(keys).not.toContain("3EB0SECRETO");
  });

  it("corpo sem objeto devolve null", () => {
    expect(describePayloadKeys(null)).toBeNull();
    expect(describePayloadKeys("texto")).toBeNull();
  });
});

describe("summarizeWebhookEvent", () => {
  it("extrai só metadados de uma mensagem de mídia", () => {
    const row = summarizeWebhookEvent({
      EventType: "messages",
      chat: { wa_chatid: "120363375380900660@g.us" },
      message: {
        messageid: "3AED88C0FAEA43AF18D9",
        chatid: "120363375380900660@g.us",
        messageType: "ImageMessage",
        messageTimestamp: 1794318009000,
        fromMe: false,
        isGroup: true,
        text: "texto que NÃO pode ser gravado",
        senderName: "Nome que NÃO pode ser gravado",
      },
    });

    expect(row).toEqual({
      event_type: "messages",
      message_id: "3AED88C0FAEA43AF18D9",
      chat_id: "120363375380900660@g.us",
      message_type: "ImageMessage",
      message_timestamp: new Date(1794318009000).toISOString(),
      from_me: false,
      is_group: true,
      payload_keys: expect.any(String),
      history_status: null,
      history_received: null,
    });
  });

  it("aceita timestamp em segundos", () => {
    const row = summarizeWebhookEvent({
      EventType: "history",
      message: { messageTimestamp: 1794318009 },
    });
    expect(row.message_timestamp).toBe(new Date(1794318009000).toISOString());
  });

  it("messages_update: pega o ID em updates[0].key.id quando não há message", () => {
    const row = summarizeWebhookEvent({
      EventType: "messages_update",
      updates: [{ key: { id: "3EB0ATUALIZADO" }, status: 3 }],
    });
    expect(row.message_id).toBe("3EB0ATUALIZADO");
    expect(row.payload_keys).toContain("updates.0.key.id");
  });

  it("messages_update: pega o ID em event.MessageIDs[0]", () => {
    const row = summarizeWebhookEvent({
      EventType: "messages",
      event: { MessageIDs: ["AC1C3E977CEF0DCC927FF4B30E5BF152"], Type: "read" },
    });
    expect(row.message_id).toBe("AC1C3E977CEF0DCC927FF4B30E5BF152");
  });

  it("history: grava status curto e contador, nunca texto livre", () => {
    const row = summarizeWebhookEvent({
      EventType: "history",
      event: { status: "completed", received_messages: 3 },
    });
    expect(row.history_status).toBe("completed");
    expect(row.history_received).toBe(3);
  });

  it("history: rejeita status com texto livre e contador inválido", () => {
    const row = summarizeWebhookEvent({
      EventType: "history",
      event: { status: "Mensagem do cliente com espaços e 123", received_messages: "3" },
    });
    expect(row.history_status).toBeNull();
    expect(row.history_received).toBeNull();
  });

  it("evento de histórico sem mensagem devolve campos nulos, sem lançar", () => {
    const row = summarizeWebhookEvent({ EventType: "history", event: "status" });
    expect(row.event_type).toBe("history");
    expect(row.message_id).toBeNull();
    expect(row.chat_id).toBeNull();
    expect(row.message_timestamp).toBeNull();
  });

  it("corpo inválido ou nulo não lança", () => {
    expect(summarizeWebhookEvent(null).event_type).toBeNull();
    expect(summarizeWebhookEvent("texto").event_type).toBeNull();
    expect(summarizeWebhookEvent([1, 2]).message_id).toBeNull();
  });
});

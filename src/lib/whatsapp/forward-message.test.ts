import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  sendMessageToConversation: vi.fn(),
  messageUpdates: [] as { id: string; patch: Record<string, unknown> }[],
}));

vi.mock("@/lib/whatsapp/send-message", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/whatsapp/send-message")>();
  return { ...actual, sendMessageToConversation: mocks.sendMessageToConversation };
});

import { forwardOneMessage } from "./forward-message";
import { ProviderRateLimitError } from "./providers/types";

function fakeDb() {
  return {
    from: (table: string) => {
      if (table !== "messages") throw new Error(`tabela não simulada: ${table}`);
      return {
        update: (patch: Record<string, unknown>) => ({
          eq: async (_col: string, id: string) => {
            mocks.messageUpdates.push({ id, patch });
            return { data: null, error: null };
          },
        }),
      };
    },
  } as never;
}

const TEXT_MESSAGE = {
  id: "msg-1",
  content_type: "text",
  content_text: "bom dia",
  media_url: null,
};

describe("forwardOneMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.messageUpdates.length = 0;
    mocks.sendMessageToConversation.mockResolvedValue({
      messageId: "m-novo",
      whatsappMessageId: "WA1",
    });
  });

  it("encaminha texto simples marcando forwarded: true", async () => {
    const result = await forwardOneMessage(
      fakeDb(),
      "acct-1",
      "user-1",
      TEXT_MESSAGE,
      "conv-a",
      undefined,
    );

    expect(result).toEqual({ ok: true });
    expect(mocks.sendMessageToConversation).toHaveBeenCalledWith(
      expect.anything(),
      "acct-1",
      expect.objectContaining({
        conversationId: "conv-a",
        messageType: "text",
        contentText: "bom dia",
        forwarded: true,
      }),
    );
  });

  it("junta a nota no mesmo balão do texto, separada por linha em branco", async () => {
    const result = await forwardOneMessage(
      fakeDb(),
      "acct-1",
      "user-1",
      TEXT_MESSAGE,
      "conv-a",
      "Olha isso aí",
    );

    expect(result).toEqual({ ok: true });
    expect(mocks.sendMessageToConversation).toHaveBeenCalledTimes(1);
    expect(mocks.sendMessageToConversation.mock.calls[0][2]).toMatchObject({
      contentText: "bom dia\n\nOlha isso aí",
    });
    expect(mocks.messageUpdates).toEqual([
      { id: "m-novo", patch: { forwarded_note: "Olha isso aí" } },
    ]);
  });

  it("junta a nota como legenda quando a mensagem é mídia", async () => {
    const result = await forwardOneMessage(
      fakeDb(),
      "acct-1",
      "user-1",
      { id: "msg-1", content_type: "image", content_text: null, media_url: "https://x/foto.jpg" },
      "conv-a",
      "segue a foto",
    );

    expect(result).toEqual({ ok: true });
    expect(mocks.sendMessageToConversation.mock.calls[0][2]).toMatchObject({
      messageType: "image",
      contentText: "segue a foto",
      forwarded: true,
    });
  });

  it("resolve o nome do arquivo pela URL quando o tipo é documento", async () => {
    await forwardOneMessage(
      fakeDb(),
      "acct-1",
      "user-1",
      {
        id: "msg-1",
        content_type: "document",
        content_text: null,
        media_url: "https://x.test/storage/contrato%20final.pdf",
      },
      "conv-a",
      undefined,
    );

    expect(mocks.sendMessageToConversation.mock.calls[0][2]).toMatchObject({
      filename: "contrato final.pdf",
    });
  });

  it("áudio manda a nota como mensagem separada — WhatsApp recusa legenda em áudio", async () => {
    const result = await forwardOneMessage(
      fakeDb(),
      "acct-1",
      "user-1",
      { id: "msg-1", content_type: "audio", content_text: null, media_url: "https://x/audio.ogg" },
      "conv-a",
      "ouve isso",
    );

    expect(result).toEqual({ ok: true });
    expect(mocks.sendMessageToConversation).toHaveBeenCalledTimes(2);
    const [forwardCall, noteCall] = mocks.sendMessageToConversation.mock.calls.map((c) => c[2]);
    expect(forwardCall).toMatchObject({ messageType: "audio", forwarded: true });
    expect(forwardCall.contentText).toBeNull();
    expect(noteCall).toMatchObject({ messageType: "text", contentText: "ouve isso" });
    expect(noteCall.forwarded).toBeFalsy();
    // Nota foi mensagem à parte -- nunca gruda no content_text encaminhado.
    expect(mocks.messageUpdates).toEqual([]);
  });

  it("em áudio, se a nota falhar depois do encaminhamento ok, o resultado é falha", async () => {
    mocks.sendMessageToConversation
      .mockResolvedValueOnce({ messageId: "m1", whatsappMessageId: "WA1" })
      .mockRejectedValueOnce(new Error("nota falhou"));

    const result = await forwardOneMessage(
      fakeDb(),
      "acct-1",
      "user-1",
      { id: "msg-1", content_type: "audio", content_text: null, media_url: "https://x/audio.ogg" },
      "conv-a",
      "segue o link",
    );

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/nota falhou/i);
  });

  it("devolve isRateLimit quando o provedor recusa por limite", async () => {
    mocks.sendMessageToConversation.mockRejectedValueOnce(
      new ProviderRateLimitError("uazapi", { providerMessage: "limite atingido" }),
    );

    const result = await forwardOneMessage(
      fakeDb(),
      "acct-1",
      "user-1",
      TEXT_MESSAGE,
      "conv-a",
      undefined,
    );

    expect(result.ok).toBe(false);
    expect(result.isRateLimit).toBe(true);
  });

  it("erro comum não marca isRateLimit", async () => {
    mocks.sendMessageToConversation.mockRejectedValueOnce(new Error("canal caiu"));

    const result = await forwardOneMessage(
      fakeDb(),
      "acct-1",
      "user-1",
      TEXT_MESSAGE,
      "conv-a",
      undefined,
    );

    expect(result.ok).toBe(false);
    expect(result.isRateLimit).toBeFalsy();
    expect(result.error).toMatch(/canal caiu/i);
  });

  it("nota vazia ou só espaço não muda o conteúdo", async () => {
    await forwardOneMessage(fakeDb(), "acct-1", "user-1", TEXT_MESSAGE, "conv-a", "   ");

    expect(mocks.sendMessageToConversation.mock.calls[0][2]).toMatchObject({
      contentText: "bom dia",
    });
  });
});

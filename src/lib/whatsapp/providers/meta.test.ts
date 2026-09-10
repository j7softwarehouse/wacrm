import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMetaProvider } from "./meta";
import { ProviderUnsupportedError } from "./types";

// O adapter delega para meta-api.ts sem lógica própria. Mockar o
// módulo prova a delegação — que é a única coisa que ele faz.
vi.mock("@/lib/whatsapp/meta-api", () => ({
  sendTextMessage: vi.fn(async () => ({ messageId: "wamid.TEXT" })),
  sendMediaMessage: vi.fn(async () => ({ messageId: "wamid.MEDIA" })),
  sendReactionMessage: vi.fn(async () => ({ messageId: "wamid.REACT" })),
  sendInteractiveButtons: vi.fn(async () => ({ messageId: "wamid.BTN" })),
  sendInteractiveList: vi.fn(async () => ({ messageId: "wamid.LIST" })),
  sendTemplateMessage: vi.fn(async () => ({ messageId: "wamid.TPL" })),
}));

import {
  sendMediaMessage,
  sendTextMessage,
} from "@/lib/whatsapp/meta-api";

const config = { phoneNumberId: "PNID", accessToken: "TOKEN" };

describe("createMetaProvider", () => {
  beforeEach(() => vi.clearAllMocks());

  it("se identifica como meta", () => {
    expect(createMetaProvider(config).kind).toBe("meta");
  });

  it("injeta as credenciais no sendText — o call site não as vê", () => {
    const provider = createMetaProvider(config);
    return provider
      .sendText({ to: "5511999999999", text: "oi" })
      .then((result) => {
        expect(result).toEqual({ messageId: "wamid.TEXT" });
        expect(sendTextMessage).toHaveBeenCalledWith({
          phoneNumberId: "PNID",
          accessToken: "TOKEN",
          to: "5511999999999",
          text: "oi",
          contextMessageId: undefined,
        });
      });
  });

  it("repassa kind, link, caption e filename no sendMedia", async () => {
    const provider = createMetaProvider(config);
    await provider.sendMedia({
      to: "5511999999999",
      kind: "document",
      link: "https://exemplo.com/a.pdf",
      caption: "segue",
      filename: "Contrato.pdf",
    });
    expect(sendMediaMessage).toHaveBeenCalledWith({
      phoneNumberId: "PNID",
      accessToken: "TOKEN",
      to: "5511999999999",
      kind: "document",
      link: "https://exemplo.com/a.pdf",
      caption: "segue",
      filename: "Contrato.pdf",
      contextMessageId: undefined,
    });
  });

  it("resolve mídia recebida para a rota de proxy, não para a URL da Meta", async () => {
    // A URL da Meta expira e exige o token da conta; o proxy resolve
    // sob demanda com a credencial do lado do servidor.
    const provider = createMetaProvider(config);
    await expect(provider.resolveInboundMediaUrl("MEDIA_ID")).resolves.toBe(
      "/api/whatsapp/media/MEDIA_ID",
    );
  });
});

describe("ProviderUnsupportedError na Meta", () => {
  it("não é lançado para templates — a Meta suporta", async () => {
    const provider = createMetaProvider(config);
    await expect(
      provider.sendTemplate({ to: "55119", templateName: "hello", language: "pt_BR" }),
    ).resolves.toEqual({ messageId: "wamid.TPL" });
  });

  it("recusa leaveGroup, updateGroupParticipants, updateGroupName, getConnectedNumber e getGroupParticipants", async () => {
    const provider = createMetaProvider(config);
    await expect(provider.leaveGroup("x@g.us")).rejects.toBeInstanceOf(
      ProviderUnsupportedError,
    );
    await expect(
      provider.updateGroupParticipants({ groupJid: "x@g.us", action: "add", phone: "1" }),
    ).rejects.toBeInstanceOf(ProviderUnsupportedError);
    await expect(
      provider.updateGroupName("x@g.us", "Nome"),
    ).rejects.toBeInstanceOf(ProviderUnsupportedError);
    await expect(provider.getConnectedNumber()).rejects.toBeInstanceOf(
      ProviderUnsupportedError,
    );
    await expect(
      provider.getGroupParticipants("x@g.us"),
    ).rejects.toBeInstanceOf(ProviderUnsupportedError);
  });
});

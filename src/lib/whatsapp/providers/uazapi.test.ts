import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderUnsupportedError } from "./types";
import { createUazapiProvider } from "./uazapi";

const post = vi.fn(async () => ({ messageid: "MSG123" }));

vi.mock("@/lib/whatsapp/uazapi/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/whatsapp/uazapi/client")>();
  return { ...actual, createUazapiClient: () => ({ post, get: vi.fn() }) };
});

const config = {
  baseUrl: "https://x.uazapi.com",
  token: "TOKEN",
  accountId: "acc-1",
};

describe("createUazapiProvider", () => {
  beforeEach(() => vi.clearAllMocks());

  it("se identifica como uazapi", () => {
    expect(createUazapiProvider(config).kind).toBe("uazapi");
  });

  it("envia texto em /send/text e lê o messageid da resposta", async () => {
    const provider = createUazapiProvider(config);
    const result = await provider.sendText({ to: "5511999999999", text: "oi" });

    expect(post).toHaveBeenCalledWith("/send/text", {
      number: "5511999999999",
      text: "oi",
    });
    // A UAZAPI chama de `messageid`; o CRM chama de `messageId`.
    expect(result).toEqual({ messageId: "MSG123" });
  });

  it("mapeia contextMessageId para replyid", async () => {
    const provider = createUazapiProvider(config);
    await provider.sendText({ to: "55119", text: "oi", contextMessageId: "ABC" });
    expect(post).toHaveBeenCalledWith("/send/text", {
      number: "55119",
      text: "oi",
      replyid: "ABC",
    });
  });

  it("envia mídia com type, file e caption em text", async () => {
    // Na UAZAPI a legenda vai no campo `text`, não em `caption`.
    const provider = createUazapiProvider(config);
    await provider.sendMedia({
      to: "55119",
      kind: "document",
      link: "https://exemplo.com/a.pdf",
      caption: "segue",
      filename: "Contrato.pdf",
    });
    expect(post).toHaveBeenCalledWith("/send/media", {
      number: "55119",
      type: "document",
      file: "https://exemplo.com/a.pdf",
      text: "segue",
      docName: "Contrato.pdf",
    });
  });

  it("envia botões como menu type=button", async () => {
    const provider = createUazapiProvider(config);
    await provider.sendInteractiveButtons({
      to: "55119",
      bodyText: "Escolha:",
      footerText: "rodapé",
      buttons: [
        { id: "sim", title: "Sim" },
        { id: "nao", title: "Não" },
      ],
    });
    expect(post).toHaveBeenCalledWith("/send/menu", {
      number: "55119",
      type: "button",
      text: "Escolha:",
      footerText: "rodapé",
      choices: ["Sim", "Não"],
    });
  });

  it("envia reação com o emoji no campo text", async () => {
    // Nomenclatura contra-intuitiva da UAZAPI: `text` é o emoji e
    // `id` é a mensagem-alvo.
    const provider = createUazapiProvider(config);
    await provider.sendReaction({
      to: "55119",
      targetMessageId: "MSG_ALVO",
      emoji: "👍",
    });
    expect(post).toHaveBeenCalledWith("/message/react", {
      number: "55119",
      id: "MSG_ALVO",
      text: "👍",
    });
  });

  it("recusa template — não existe na UAZAPI", async () => {
    const provider = createUazapiProvider(config);
    await expect(
      provider.sendTemplate({ to: "55119", templateName: "x", language: "pt_BR" }),
    ).rejects.toBeInstanceOf(ProviderUnsupportedError);
  });
});

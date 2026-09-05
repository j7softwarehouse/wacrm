import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderUnsupportedError } from "./types";
import { createUazapiProvider } from "./uazapi";

const post = vi.fn(async () => ({ messageid: "MSG123" }));
const get = vi.fn(async () => ({ groups: [] as unknown[] }));

vi.mock("@/lib/whatsapp/uazapi/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/whatsapp/uazapi/client")>();
  return { ...actual, createUazapiClient: () => ({ post, get }) };
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

  it("lista grupos via GET /group/list mapeando JID/Name — sem avatarUrl", async () => {
    // Schema real (Go/Baileys, PascalCase) confirmado contra a instância
    // j7softwarehouse.uazapi.com com um grupo de teste. Este endpoint não
    // devolve foto/avatar — avatarUrl fica sempre undefined.
    get.mockResolvedValueOnce({
      groups: [
        {
          JID: "120363429748080632@g.us",
          Name: "Teste",
          OwnerJID: "81811157827760@lid",
          Participants: [
            {
              JID: "81811157827760@lid",
              PhoneNumber: "553183886076@s.whatsapp.net",
              IsAdmin: true,
            },
          ],
          ParticipantCount: 2,
        },
      ],
    });

    const provider = createUazapiProvider(config);
    const result = await provider.listGroups();

    expect(get).toHaveBeenCalledWith("/group/list");
    expect(result).toEqual([
      {
        groupJid: "120363429748080632@g.us",
        name: "Teste",
        avatarUrl: undefined,
      },
    ]);
  });

  it("lista vazia quando a conta não participa de nenhum grupo", async () => {
    get.mockResolvedValueOnce({ groups: [] });
    const provider = createUazapiProvider(config);
    await expect(provider.listGroups()).resolves.toEqual([]);
  });

  it("sai do grupo via POST /group/leave", async () => {
    post.mockResolvedValueOnce({ response: "Group leave successful" } as any);
    const provider = createUazapiProvider(config);
    await provider.leaveGroup("120363429748080632@g.us");
    expect(post).toHaveBeenCalledWith("/group/leave", {
      groupjid: "120363429748080632@g.us",
    });
  });

  it("atualiza participante via POST /group/updateParticipants quando Error=0", async () => {
    post.mockResolvedValueOnce({
      group: {},
      groupUpdated: [
        { PhoneNumber: "5511999999999@s.whatsapp.net", IsAdmin: false, Error: 0 },
      ],
      needs_refresh: false,
    } as any);
    const provider = createUazapiProvider(config);
    await provider.updateGroupParticipants({
      groupJid: "120363429748080632@g.us",
      action: "add",
      phone: "5511999999999",
    });
    expect(post).toHaveBeenCalledWith("/group/updateParticipants", {
      groupjid: "120363429748080632@g.us",
      action: "add",
      participants: ["5511999999999"],
    });
  });

  it("lança quando updateParticipants devolve Error != 0 mesmo com HTTP 200", async () => {
    // Achado empírico (spec §1): a uazapi responde 200 mesmo quando a
    // ação falhou -- o resultado real vem aninhado por telefone.
    post.mockResolvedValueOnce({
      group: {},
      groupUpdated: [
        { PhoneNumber: "553183839660@s.whatsapp.net", IsAdmin: true, Error: 409 },
      ],
      needs_refresh: false,
    } as any);
    const provider = createUazapiProvider(config);
    await expect(
      provider.updateGroupParticipants({
        groupJid: "120363429748080632@g.us",
        action: "add",
        phone: "553183839660",
      }),
    ).rejects.toThrow(/409/);
  });

  it("lança quando updateParticipants nao devolve entrada para o telefone enviado", async () => {
    post.mockResolvedValueOnce({ group: {}, groupUpdated: [], needs_refresh: false } as any);
    const provider = createUazapiProvider(config);
    await expect(
      provider.updateGroupParticipants({
        groupJid: "120363429748080632@g.us",
        action: "remove",
        phone: "5511999999999",
      }),
    ).rejects.toThrow();
  });

  it("remove participante @lid mesmo quando a resposta devolve o telefone JA RESOLVIDO (nao bate com o JID enviado)", async () => {
    // Achado real, confirmado contra a instancia uazapi: ao remover um
    // participante que só existia como JID @lid, o campo PhoneNumber da
    // resposta vem com o telefone real JA RESOLVIDO pela uazapi
    // (ex.: "553175011847@s.whatsapp.net"), que nunca vai bater com
    // ".startsWith(jidEnviado)" quando jidEnviado é o próprio "@lid".
    // Casar por índice (um telefone enviado -> uma entrada devolvida)
    // em vez de por valor evita esse descasamento.
    post.mockResolvedValueOnce({
      group: {},
      groupUpdated: [
        {
          JID: "36460128415934@lid",
          PhoneNumber: "553175011847@s.whatsapp.net",
          IsAdmin: false,
          Error: 0,
        },
      ],
      needs_refresh: false,
    } as any);
    const provider = createUazapiProvider(config);
    await expect(
      provider.updateGroupParticipants({
        groupJid: "120363429748080632@g.us",
        action: "remove",
        phone: "36460128415934@lid",
      }),
    ).resolves.toBeUndefined();
  });

  it("renomeia grupo via POST /group/updateName", async () => {
    post.mockResolvedValueOnce({} as any);
    const provider = createUazapiProvider(config);
    await provider.updateGroupName("120363429748080632@g.us", "Novo Nome");
    expect(post).toHaveBeenCalledWith("/group/updateName", {
      groupjid: "120363429748080632@g.us",
      name: "Novo Nome",
    });
  });

  it("lê o número conectado via GET /instance/status", async () => {
    get.mockResolvedValueOnce({ instance: { owner: "553183886076" } } as any);
    const provider = createUazapiProvider(config);
    await expect(provider.getConnectedNumber()).resolves.toBe("553183886076");
    expect(get).toHaveBeenCalledWith("/instance/status");
  });

  it("lança quando /instance/status nao devolve owner", async () => {
    get.mockResolvedValueOnce({ instance: {} } as any);
    const provider = createUazapiProvider(config);
    await expect(provider.getConnectedNumber()).rejects.toThrow();
  });

  it("lê participantes de um grupo via GET /group/list, filtrando pelo JID", async () => {
    get.mockResolvedValueOnce({
      groups: [
        {
          JID: "outro@g.us",
          Name: "Outro",
          Participants: [{ PhoneNumber: "5500000000000@s.whatsapp.net", IsAdmin: true }],
        },
        {
          JID: "120363429748080632@g.us",
          Name: "Teste",
          Participants: [
            { PhoneNumber: "553183886076@s.whatsapp.net", IsAdmin: false },
            { PhoneNumber: "553183839660@s.whatsapp.net", IsAdmin: true },
          ],
        },
      ],
    } as any);
    const provider = createUazapiProvider(config);
    const result = await provider.getGroupParticipants("120363429748080632@g.us");
    expect(result).toEqual([
      { phoneNumber: "553183886076", isAdmin: false },
      { phoneNumber: "553183839660", isAdmin: true },
    ]);
  });

  it("lança quando getGroupParticipants nao acha o grupo na lista", async () => {
    get.mockResolvedValueOnce({ groups: [] } as any);
    const provider = createUazapiProvider(config);
    await expect(
      provider.getGroupParticipants("nao-existe@g.us"),
    ).rejects.toThrow();
  });

  it("usa o JID @lid como identificador quando PhoneNumber vem vazio (participante recem-adicionado)", async () => {
    // Achado real em homolog: um participante identificado só por JID
    // opaco (@lid, modo de privacidade do WhatsApp) tem PhoneNumber
    // vazio em /group/list logo após ser adicionado. Sem essa
    // alternativa o participante fica sem identificador nenhum — não
    // aparece na tela e não dá pra remover/promover (confirmado que
    // updateParticipants aceita o JID @lid completo como identificador).
    get.mockResolvedValueOnce({
      groups: [
        {
          JID: "120363429748080632@g.us",
          Name: "Teste",
          Participants: [
            { JID: "36460128415934@lid", PhoneNumber: "", LID: "", IsAdmin: false },
          ],
        },
      ],
    } as any);
    const provider = createUazapiProvider(config);
    const result = await provider.getGroupParticipants("120363429748080632@g.us");
    expect(result).toEqual([
      { phoneNumber: "36460128415934@lid", isAdmin: false },
    ]);
  });
});

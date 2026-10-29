import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  // Assinatura explícita (2 params) — sem isso o TS infere `calls` como
  // tupla de tamanho 0 a partir do corpo do mock, e os testes abaixo
  // não conseguem indexar `mock.calls[0][1]`.
  ingestInboundMessage: vi.fn(async (_db: unknown, _params: unknown) => ({
    ok: true,
  })),
  isGroupEnabled: vi.fn(async () => true),
  resolveInboundMediaUrl: vi.fn(
    async (_ref: string): Promise<string | null> => "https://storage/x.jpg",
  ),
}));

vi.mock("@/lib/whatsapp/groups/resolve-group-conversation", () => ({
  isGroupEnabled: mocks.isGroupEnabled,
}));
vi.mock("@/lib/whatsapp/providers/resolve", () => ({
  getProviderForChannel: async () => ({
    resolveInboundMediaUrl: mocks.resolveInboundMediaUrl,
  }),
}));

// `ingestInboundMessage` já tem suíte própria (ingest.test.ts) — aqui só
// interessa PROVAR que handleEvent chama (ou não chama) com os
// argumentos certos, não repetir a lógica de ingestão dela.
vi.mock("@/lib/whatsapp/inbound/ingest", () => ({
  ingestInboundMessage: mocks.ingestInboundMessage,
}));

// ============================================================
// Fake Supabase em memória — só o suficiente pro que handleEvent usa:
// `.select().in()/.eq()` (leitura) e `.update().in()/.eq()` (escrita),
// sempre awaited direto (o builder real é "thenable"). Estado real (não
// stubs que ignoram argumento) — é o que torna a asserção de
// isolamento por conta/canal uma prova de verdade, não decoração.
// ============================================================
/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

let messagesTable: Row[] = [];
let conversationsTable: Row[] = [];
let channelsTable: Row[] = [];

class FakeChain implements PromiseLike<{ data: any; error: any }> {
  private conds: Array<(row: Row) => boolean> = [];
  private mode: "select" | "update" = "select";
  private updatePayload: Row | null = null;

  constructor(private rows: Row[]) {}

  select(_cols?: string) {
    this.mode = "select";
    return this;
  }
  update(payload: Row) {
    this.mode = "update";
    this.updatePayload = payload;
    return this;
  }
  eq(col: string, val: unknown) {
    this.conds.push((r) => r[col] === val);
    return this;
  }
  in(col: string, vals: unknown[]) {
    this.conds.push((r) => vals.includes(r[col]));
    return this;
  }
  is(col: string, val: unknown) {
    this.conds.push((r) =>
      val === null ? r[col] === null || r[col] === undefined : r[col] === val,
    );
    return this;
  }

  private matched(): Row[] {
    return this.rows.filter((r) => this.conds.every((c) => c(r)));
  }

  then<TResult1 = any, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: any; error: any }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    const matched = this.matched();
    if (this.mode === "update") {
      matched.forEach((r) => Object.assign(r, this.updatePayload));
    }
    return Promise.resolve({ data: matched, error: null }).then(
      onfulfilled,
      onrejected,
    );
  }
}

function tableFor(name: string): Row[] {
  if (name === "messages") return messagesTable;
  if (name === "conversations") return conversationsTable;
  if (name === "whatsapp_channels") return channelsTable;
  throw new Error(`fake supabase: tabela não suportada em teste: ${name}`);
}

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: (table: string) => new FakeChain(tableFor(table)),
  }),
}));

import { handleEvent } from "./route";
import type { WhatsAppChannel } from "@/types";

const CHANNEL: WhatsAppChannel = {
  id: "chan-1",
  account_id: "acct-1",
  user_id: "user-1",
  provider: "uazapi",
  status: "connected",
};

const OTHER_CONV = { id: "conv-outra", account_id: "acct-OUTRA", channel_id: "chan-1" };
const CONV = { id: "conv-1", account_id: "acct-1", channel_id: "chan-1" };

beforeEach(() => {
  vi.clearAllMocks();
  messagesTable = [];
  conversationsTable = [CONV, OTHER_CONV];
  channelsTable = [];
});

describe("handleEvent — mensagem normal (regressão)", () => {
  it("sem campo edited chama ingestInboundMessage normalmente", async () => {
    // Formato real capturado (2026-09-11): EventType "messages",
    // conteúdo em `message`, `edited` vazio.
    const body = {
      EventType: "messages",
      message: {
        chatid: "5511999999999@s.whatsapp.net",
        content: "teste 2",
        edited: "",
        fromMe: false,
        isGroup: false,
        messageType: "Conversation",
        messageTimestamp: 1789135598000,
        messageid: "3EB0D0B896DF5B018F84E7",
        sender_pn: "5511999999999@s.whatsapp.net",
        text: "teste 2",
        wasSentByApi: false,
      },
    };

    await handleEvent(CHANNEL, body);

    expect(mocks.ingestInboundMessage).toHaveBeenCalledTimes(1);
    expect(mocks.ingestInboundMessage.mock.calls[0][1]).toMatchObject({
      providerMessageId: "3EB0D0B896DF5B018F84E7",
      content: expect.objectContaining({ text: "teste 2" }),
    });
    expect(messagesTable).toHaveLength(0); // handleEvent não grava — quem grava é ingestInboundMessage (mockado)
  });

  it("loga quando algum campo do payload menciona 'forward', mas continua ingerindo normalmente", async () => {
    // Doc da uazapi não documenta nenhum campo de "mensagem
    // encaminhada pelo cliente" (nem isForwarded, nem contextInfo) —
    // mesma situação do evento "history". Em vez de arriscar o nome
    // errado, o diagnóstico procura qualquer CHAVE (em qualquer nível)
    // que contenha "forward", não um nome específico. Usa um campo
    // fictício e ANINHADO pra provar que a busca não é só superficial.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const body = {
      EventType: "messages",
      message: {
        chatid: "5511999999999@s.whatsapp.net",
        content: "oi, vejam isso",
        edited: "",
        fromMe: false,
        isGroup: false,
        messageType: "Conversation",
        messageTimestamp: 1789135598000,
        messageid: "3EB0D0B896DF5B018F84E8",
        sender_pn: "5511999999999@s.whatsapp.net",
        text: "oi, vejam isso",
        wasSentByApi: false,
        contextInfo: { isForwarded: true },
      },
    };

    await handleEvent(CHANNEL, body);

    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("encaminhamento"),
      expect.arrayContaining([expect.stringContaining("contextInfo.isForwarded")]),
      expect.anything(),
    );
    // Diagnóstico não pode atrapalhar o fluxo normal — a mensagem
    // continua sendo ingerida mesmo com o campo encontrado.
    expect(mocks.ingestInboundMessage).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("não loga nada quando o payload não tem nenhum campo relacionado a encaminhamento", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const body = {
      EventType: "messages",
      message: {
        chatid: "5511999999999@s.whatsapp.net",
        content: "mensagem comum",
        edited: "",
        fromMe: false,
        isGroup: false,
        messageType: "Conversation",
        messageTimestamp: 1789135598000,
        messageid: "3EB0D0B896DF5B018F84E9",
        sender_pn: "5511999999999@s.whatsapp.net",
        text: "mensagem comum",
        wasSentByApi: false,
      },
    };

    await handleEvent(CHANNEL, body);

    expect(spy).not.toHaveBeenCalledWith(
      expect.stringContaining("encaminhamento"),
      expect.anything(),
      expect.anything(),
    );
    spy.mockRestore();
  });
});

describe("handleEvent — edição pelo próprio participante", () => {
  const editBody = {
    EventType: "messages",
    message: {
      chatid: "120363429748080632@g.us",
      content: { text: "teste 2 de edição" },
      edited: "3EB0D0B896DF5B018F84E7", // aponta pro message_id ORIGINAL
      fromMe: false,
      isGroup: true,
      messageType: "ExtendedTextMessage",
      messageTimestamp: 1789135608000,
      messageid: "3EB01ED0A5F3963604E3", // id da versão EDITADA
      sender_pn: "553183839660@s.whatsapp.net",
      text: "teste 2 de edição",
      wasSentByApi: false,
    },
  };

  it("mensagem original conhecida: atualiza content_text/message_id/edited_at, não cria mensagem nova", async () => {
    messagesTable = [
      {
        id: "msg-1",
        message_id: "3EB0D0B896DF5B018F84E7",
        conversation_id: "conv-1",
        content_text: "teste 2",
        original_content_text: null,
        sender_type: "customer",
      },
    ];

    await handleEvent(CHANNEL, editBody);

    expect(mocks.ingestInboundMessage).not.toHaveBeenCalled();
    expect(messagesTable).toHaveLength(1); // não duplicou linha
    const row = messagesTable[0];
    expect(row.content_text).toBe("teste 2 de edição");
    expect(row.message_id).toBe("3EB01ED0A5F3963604E3");
    expect(row.original_content_text).toBe("teste 2"); // guardou o texto de antes
    expect(row.edited_at).toEqual(expect.any(String));
  });

  it("segunda edição NÃO sobrescreve original_content_text já preenchido", async () => {
    messagesTable = [
      {
        id: "msg-1",
        message_id: "3EB0D0B896DF5B018F84E7",
        conversation_id: "conv-1",
        content_text: "primeira correção",
        original_content_text: "o texto de verdade original",
        sender_type: "customer",
      },
    ];

    await handleEvent(CHANNEL, editBody);

    expect(messagesTable[0].original_content_text).toBe(
      "o texto de verdade original",
    );
    expect(messagesTable[0].content_text).toBe("teste 2 de edição");
  });

  it("mensagem original desconhecida: cai pro fluxo normal (vira mensagem nova)", async () => {
    messagesTable = []; // nada corresponde a message_id "3EB0D0B896DF5B018F84E7"

    await handleEvent(CHANNEL, editBody);

    expect(mocks.ingestInboundMessage).toHaveBeenCalledTimes(1);
    expect(mocks.ingestInboundMessage.mock.calls[0][1]).toMatchObject({
      providerMessageId: "3EB01ED0A5F3963604E3",
    });
  });

  it("mensagem original de OUTRA conta não é alterada (isolamento)", async () => {
    messagesTable = [
      {
        id: "msg-outra-conta",
        message_id: "3EB0D0B896DF5B018F84E7",
        conversation_id: "conv-outra", // pertence a acct-OUTRA, não acct-1
        content_text: "mensagem de outra conta",
        original_content_text: null,
        sender_type: "customer",
      },
    ];

    await handleEvent(CHANNEL, editBody);

    // Não achou (por conta do isolamento) → caiu pro fluxo normal.
    expect(mocks.ingestInboundMessage).toHaveBeenCalledTimes(1);
    // A linha da outra conta continua intocada.
    expect(messagesTable[0].content_text).toBe("mensagem de outra conta");
    expect(messagesTable[0].message_id).toBe("3EB0D0B896DF5B018F84E7");
  });

  it("eco de uma edição feita pelo próprio CRM (fromMe/wasSentByApi) é ignorado", async () => {
    messagesTable = [
      {
        id: "msg-1",
        message_id: "3EB0D0B896DF5B018F84E7",
        conversation_id: "conv-1",
        content_text: "teste 2",
        original_content_text: null,
        sender_type: "agent",
      },
    ];

    await handleEvent(CHANNEL, {
      EventType: "messages",
      message: { ...editBody.message, fromMe: true },
    });

    // Nem aplicou a edição, nem tratou como mensagem nova — é eco do
    // que o próprio CRM já gravou via POST .../messages/[id]/edit.
    expect(mocks.ingestInboundMessage).not.toHaveBeenCalled();
    expect(messagesTable[0].content_text).toBe("teste 2");
  });
});

describe("handleEvent — exclusão pelo próprio participante", () => {
  // Formato real capturado (2026-09-11): EventType "messages_update",
  // corpo em `event` (não `data`/`message`), Type "Deleted", MessageIDs
  // em lista.
  const deleteBody = {
    EventType: "messages_update",
    event: {
      Chat: "120363429748080632@g.us",
      IsFromMe: false,
      IsGroup: true,
      MessageIDs: ["3EB05D674E6458F4F2402F"],
      Type: "Deleted",
    },
  };

  it("marca deleted_at sem tocar content_text", async () => {
    messagesTable = [
      {
        id: "msg-2",
        message_id: "3EB05D674E6458F4F2402F",
        conversation_id: "conv-1",
        content_text: "teste 2 de exclusão",
        deleted_at: null,
        sender_type: "customer",
      },
    ];

    await handleEvent(CHANNEL, deleteBody);

    const row = messagesTable[0];
    expect(row.deleted_at).toEqual(expect.any(String));
    expect(row.content_text).toBe("teste 2 de exclusão"); // NUNCA tocado
  });

  it("não apaga mensagem de OUTRA conta (isolamento)", async () => {
    messagesTable = [
      {
        id: "msg-outra-conta",
        message_id: "3EB05D674E6458F4F2402F",
        conversation_id: "conv-outra",
        content_text: "mensagem de outra conta",
        deleted_at: null,
        sender_type: "customer",
      },
    ];

    await handleEvent(CHANNEL, deleteBody);

    expect(messagesTable[0].deleted_at).toBeNull();
  });
});

describe("handleEvent — status de entrega (compatibilidade com o formato antigo)", () => {
  it("evento messages_update com data.status ainda atualiza o status", async () => {
    messagesTable = [
      {
        id: "msg-3",
        message_id: "WAMID-3",
        conversation_id: "conv-1",
        content_text: "oi",
        status: "sent",
        sender_type: "agent",
      },
    ];

    await handleEvent(CHANNEL, {
      event: "messages_update", // vocabulário antigo, minúsculo
      data: { messageid: "WAMID-3", status: "delivered" },
    });

    expect(messagesTable[0].status).toBe("delivered");
  });
});

describe("handleEvent — status de entrega nunca regride (relato 20/10/2026)", () => {
  // Formato real: EventType "messages_update", corpo em `event`, Type com
  // o estado e MessageIDs em lista.
  const evento = (type: string, id = "WAMID-9") => ({
    EventType: "messages_update",
    event: { Chat: "5511999999999@s.whatsapp.net", MessageIDs: [id], Type: type },
  });
  const msg = (status: string) => ({
    id: "msg-9",
    message_id: "WAMID-9",
    conversation_id: "conv-1",
    content_text: "oi",
    status,
    sender_type: "agent",
  });

  it("'entregue' chegando DEPOIS de 'lido' não volta o balão para cinza", async () => {
    messagesTable = [msg("read")];

    await handleEvent(CHANNEL, evento("Delivered"));

    expect(messagesTable[0].status).toBe("read");
  });

  it("'enviado' atrasado não regride uma mensagem já entregue", async () => {
    messagesTable = [msg("delivered")];

    await handleEvent(CHANNEL, evento("Sent"));

    expect(messagesTable[0].status).toBe("delivered");
  });

  it("'lido' avança uma mensagem entregue", async () => {
    messagesTable = [msg("delivered")];

    await handleEvent(CHANNEL, evento("Read"));

    expect(messagesTable[0].status).toBe("read");
  });

  it("'lido' avança direto de 'enviado' quando o 'entregue' se perdeu", async () => {
    messagesTable = [msg("sent")];

    await handleEvent(CHANNEL, evento("Read"));

    expect(messagesTable[0].status).toBe("read");
  });

  it("'tocado' (áudio ouvido) também vira lido", async () => {
    messagesTable = [msg("delivered")];

    await handleEvent(CHANNEL, evento("Played"));

    expect(messagesTable[0].status).toBe("read");
  });
});

describe("handleEvent — evento 'history' (recuperação de mensagem Undecryptable)", () => {
  // Formato confirmado ao vivo em 27/10/2026 contra uma instância real
  // (ver comentário de applyHistoryRecovery em route.ts): um pedido de
  // recuperação (mode=history, ancorado na mensagem seguinte — ver
  // request-recovery/route.ts) devolve vários webhooks `history` em
  // sequência, cada um com um `event` interno diferente ("status",
  // "chats", "messages"); só "messages" nos interessa, e cada item do
  // lote tem os mesmos campos de um evento `messages` comum.
  const historyMessagesEvent = (messages: Record<string, unknown>[]) => ({
    EventType: "history",
    event: "messages",
    messages,
  });

  const UNDECRYPTABLE_TEXT =
    "[Undecryptable] [media] [image] Não foi possível descriptografar a mensagem. Abra o WhatsApp no seu celular para visualizá-la.";

  it("ignora sub-eventos 'status' e 'chats' sem tentar atualizar nada", async () => {
    messagesTable = [
      {
        id: "msg-1",
        message_id: "3EB01ED0A5F3963604E3",
        conversation_id: "conv-1",
        content_type: "text",
        content_text: UNDECRYPTABLE_TEXT,
        sender_type: "customer",
      },
    ];

    await handleEvent(CHANNEL, { EventType: "history", event: "status", status: "completed" });
    await handleEvent(CHANNEL, { EventType: "history", event: "chats", chats: [{ id: "x" }] });

    expect(messagesTable[0].content_text).toBe(UNDECRYPTABLE_TEXT);
  });

  it("mensagem de TEXTO recuperada substitui o placeholder (casando por messageid)", async () => {
    messagesTable = [
      {
        id: "msg-1",
        message_id: "3EB01ED0A5F3963604E3",
        conversation_id: "conv-1",
        content_type: "text",
        content_text: UNDECRYPTABLE_TEXT,
        sender_type: "customer",
      },
    ];
    const body = historyMessagesEvent([
      {
        messageid: "3EB01ED0A5F3963604E3",
        chatid: "553183839660@s.whatsapp.net",
        content: "Oi, chegou?",
        text: "Oi, chegou?",
        messageType: "Conversation",
        fromMe: false,
        isGroup: false,
        sender_pn: "553183839660@s.whatsapp.net",
        wasSentByApi: false,
      },
    ]);

    await handleEvent(CHANNEL, body);

    expect(messagesTable[0].content_type).toBe("text");
    expect(messagesTable[0].content_text).toBe("Oi, chegou?");
    expect(messagesTable[0].media_url).toBeNull();
  });

  it("mensagem de MÍDIA recuperada resolve a URL e limpa o content_text", async () => {
    messagesTable = [
      {
        id: "msg-1",
        message_id: "3EB07838F9DC22042F9508",
        conversation_id: "conv-1",
        content_type: "image",
        content_text: UNDECRYPTABLE_TEXT,
        sender_type: "customer",
      },
    ];
    const body = historyMessagesEvent([
      {
        messageid: "3EB07838F9DC22042F9508",
        chatid: "553183839660@s.whatsapp.net",
        content: {
          URL: "https://mmg.whatsapp.net/x.enc",
          mediaKey: "chave-base64",
          mimetype: "image/jpeg",
          fileName: "foto.jpg",
        },
        text: "",
        messageType: "ImageMessage",
        fromMe: false,
        isGroup: false,
        sender_pn: "553183839660@s.whatsapp.net",
        wasSentByApi: false,
      },
    ]);

    await handleEvent(CHANNEL, body);

    expect(mocks.resolveInboundMediaUrl).toHaveBeenCalledTimes(1);
    expect(messagesTable[0].content_type).toBe("image");
    expect(messagesTable[0].media_url).toBe("https://storage/x.jpg");
    expect(messagesTable[0].content_text).toBeNull();
  });

  it("messageid sem placeholder correspondente: ignora, não cria nem altera nada", async () => {
    messagesTable = [
      {
        id: "msg-1",
        message_id: "OUTRO-ID-QUALQUER",
        conversation_id: "conv-1",
        content_type: "text",
        content_text: "mensagem comum, sem relação",
        sender_type: "customer",
      },
    ];
    const antes = JSON.parse(JSON.stringify(messagesTable));
    const body = historyMessagesEvent([
      {
        messageid: "3EB0NAOCADASTRADO",
        chatid: "553183839660@s.whatsapp.net",
        content: "mensagem antiga não relacionada",
        text: "mensagem antiga não relacionada",
        messageType: "Conversation",
        fromMe: false,
        isGroup: false,
        sender_pn: "553183839660@s.whatsapp.net",
        wasSentByApi: false,
      },
    ]);

    await handleEvent(CHANNEL, body);

    expect(messagesTable).toEqual(antes);
  });

  it("messageid bate, mas a linha já não é mais um placeholder: NUNCA sobrescreve mensagem comum", async () => {
    messagesTable = [
      {
        id: "msg-1",
        message_id: "3EB01ED0A5F3963604E3",
        conversation_id: "conv-1",
        content_type: "text",
        content_text: "mensagem normal do cliente, nada a ver",
        sender_type: "customer",
      },
    ];
    const body = historyMessagesEvent([
      {
        messageid: "3EB01ED0A5F3963604E3",
        chatid: "553183839660@s.whatsapp.net",
        content: "conteúdo recuperado por coincidência de id",
        text: "conteúdo recuperado por coincidência de id",
        messageType: "Conversation",
        fromMe: false,
        isGroup: false,
        sender_pn: "553183839660@s.whatsapp.net",
        wasSentByApi: false,
      },
    ]);

    await handleEvent(CHANNEL, body);

    expect(messagesTable[0].content_text).toBe(
      "mensagem normal do cliente, nada a ver",
    );
  });

  it("mídia recebida SEM arquivo recebe o arquivo recuperado e não toca no texto nem no tipo", async () => {
    messagesTable = [
      {
        id: "msg-2",
        message_id: "3EB0SEMARQUIVO0001",
        conversation_id: "conv-1",
        content_type: "image",
        content_text: "legenda que o cliente escreveu",
        media_url: null,
        sender_type: "customer",
      },
    ];
    const body = historyMessagesEvent([
      {
        messageid: "3EB0SEMARQUIVO0001",
        chatid: "553183839660@s.whatsapp.net",
        content: {
          URL: "https://mmg.whatsapp.net/y.enc",
          mediaKey: "chave-base64",
          mimetype: "image/jpeg",
        },
        text: "",
        messageType: "ImageMessage",
        fromMe: false,
        isGroup: false,
        sender_pn: "553183839660@s.whatsapp.net",
        wasSentByApi: false,
      },
    ]);

    await handleEvent(CHANNEL, body);

    expect(mocks.resolveInboundMediaUrl).toHaveBeenCalledTimes(1);
    expect(messagesTable[0].media_url).toBe("https://storage/x.jpg");
    expect(messagesTable[0].content_type).toBe("image");
    expect(messagesTable[0].content_text).toBe("legenda que o cliente escreveu");
  });

  it("mídia que já tem arquivo não é baixada de novo nem sobrescrita", async () => {
    messagesTable = [
      {
        id: "msg-3",
        message_id: "3EB0JATEMARQUIVO01",
        conversation_id: "conv-1",
        content_type: "image",
        content_text: null,
        media_url: "https://storage/original.jpg",
        sender_type: "customer",
      },
    ];
    const body = historyMessagesEvent([
      {
        messageid: "3EB0JATEMARQUIVO01",
        chatid: "553183839660@s.whatsapp.net",
        content: {
          URL: "https://mmg.whatsapp.net/z.enc",
          mediaKey: "chave-base64",
          mimetype: "image/jpeg",
        },
        text: "",
        messageType: "ImageMessage",
        fromMe: false,
        isGroup: false,
        sender_pn: "553183839660@s.whatsapp.net",
        wasSentByApi: false,
      },
    ]);

    await handleEvent(CHANNEL, body);

    expect(mocks.resolveInboundMediaUrl).not.toHaveBeenCalled();
    expect(messagesTable[0].media_url).toBe("https://storage/original.jpg");
  });

  it("arquivo recuperado de tipo diferente do registrado não é aplicado", async () => {
    messagesTable = [
      {
        id: "msg-4",
        message_id: "3EB0TIPODIFERENTE01",
        conversation_id: "conv-1",
        content_type: "image",
        content_text: null,
        media_url: null,
        sender_type: "customer",
      },
    ];
    const body = historyMessagesEvent([
      {
        messageid: "3EB0TIPODIFERENTE01",
        chatid: "553183839660@s.whatsapp.net",
        content: {
          URL: "https://mmg.whatsapp.net/w.enc",
          mediaKey: "chave-base64",
          mimetype: "application/pdf",
        },
        text: "",
        messageType: "DocumentMessage",
        fromMe: false,
        isGroup: false,
        sender_pn: "553183839660@s.whatsapp.net",
        wasSentByApi: false,
      },
    ]);

    await handleEvent(CHANNEL, body);

    expect(mocks.resolveInboundMediaUrl).not.toHaveBeenCalled();
    expect(messagesTable[0].media_url).toBeNull();
  });

  it("se o WhatsApp já não tem o arquivo, a linha fica como estava", async () => {
    mocks.resolveInboundMediaUrl.mockResolvedValueOnce(null);
    messagesTable = [
      {
        id: "msg-5",
        message_id: "3EB0CDNEXPIROU0001",
        conversation_id: "conv-1",
        content_type: "image",
        content_text: "legenda",
        media_url: null,
        sender_type: "customer",
      },
    ];
    const body = historyMessagesEvent([
      {
        messageid: "3EB0CDNEXPIROU0001",
        chatid: "553183839660@s.whatsapp.net",
        content: {
          URL: "https://mmg.whatsapp.net/v.enc",
          mediaKey: "chave-base64",
          mimetype: "image/jpeg",
        },
        text: "",
        messageType: "ImageMessage",
        fromMe: false,
        isGroup: false,
        sender_pn: "553183839660@s.whatsapp.net",
        wasSentByApi: false,
      },
    ]);

    await handleEvent(CHANNEL, body);

    expect(mocks.resolveInboundMediaUrl).toHaveBeenCalledTimes(1);
    expect(messagesTable[0].media_url).toBeNull();
    expect(messagesTable[0].content_text).toBe("legenda");
  });

  it("mensagem de TEXTO sem arquivo não entra na recuperação de mídia", async () => {
    messagesTable = [
      {
        id: "msg-6",
        message_id: "3EB0TEXTOSEMARQ0001",
        conversation_id: "conv-1",
        content_type: "text",
        content_text: "texto antigo",
        media_url: null,
        sender_type: "customer",
      },
    ];
    const body = historyMessagesEvent([
      {
        messageid: "3EB0TEXTOSEMARQ0001",
        chatid: "553183839660@s.whatsapp.net",
        content: "texto recuperado",
        text: "texto recuperado",
        messageType: "Conversation",
        fromMe: false,
        isGroup: false,
        sender_pn: "553183839660@s.whatsapp.net",
        wasSentByApi: false,
      },
    ]);

    await handleEvent(CHANNEL, body);

    expect(mocks.resolveInboundMediaUrl).not.toHaveBeenCalled();
    expect(messagesTable[0].content_text).toBe("texto antigo");
  });
});

describe("handleEvent — mídia de grupo só é baixada se o grupo estiver habilitado", () => {
  const imagem = (isGroup: boolean) => ({
    EventType: "messages",
    message: {
      chatid: isGroup ? "120363000000000000@g.us" : "5511999999999@s.whatsapp.net",
      isGroup,
      fromMe: false,
      messageType: "ImageMessage",
      messageTimestamp: 1789135598000,
      messageid: "IMG1",
      sender_pn: "5511999999999@s.whatsapp.net",
      senderName: "Fulana",
      content: { URL: "https://cdn.whatsapp.net/x.enc", mediaKey: "a2V5a2V5a2V5a2V5a2V5a2V5a2V5a2V5MTIzNDU2", mimetype: "image/jpeg" },
      wasSentByApi: false,
    },
  });

  it("grupo DESABILITADO: não baixa a mídia, mas ainda chama o ingest (que registra o grupo pra tela de seleção)", async () => {
    mocks.isGroupEnabled.mockResolvedValueOnce(false);

    await handleEvent(CHANNEL, imagem(true));

    expect(mocks.resolveInboundMediaUrl).not.toHaveBeenCalled();
    expect(mocks.ingestInboundMessage).toHaveBeenCalledTimes(1);
  });

  it("grupo HABILITADO: baixa a mídia normalmente", async () => {
    mocks.isGroupEnabled.mockResolvedValueOnce(true);

    await handleEvent(CHANNEL, imagem(true));

    expect(mocks.resolveInboundMediaUrl).toHaveBeenCalledTimes(1);
  });

  it("conversa 1:1: baixa a mídia sem nem consultar o grupo", async () => {
    await handleEvent(CHANNEL, imagem(false));

    expect(mocks.isGroupEnabled).not.toHaveBeenCalled();
    expect(mocks.resolveInboundMediaUrl).toHaveBeenCalledTimes(1);
  });
});

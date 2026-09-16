import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  // Assinatura explícita (2 params) — sem isso o TS infere `calls` como
  // tupla de tamanho 0 a partir do corpo do mock, e os testes abaixo
  // não conseguem indexar `mock.calls[0][1]`.
  ingestInboundMessage: vi.fn(async (_db: unknown, _params: unknown) => ({
    ok: true,
  })),
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

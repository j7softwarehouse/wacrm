import { describe, expect, it } from "vitest";
import { encrypt } from "@/lib/whatsapp/encryption";
import { ProviderNotConnectedError } from "./types";
import {
  ChannelNotFoundError,
  NoChannelConfiguredError,
  getProviderForChannel,
  getProviderForConversation,
} from "./resolve";

/**
 * Stub mínimo do SupabaseClient: só o encadeamento
 * from().select().eq().maybeSingle() que o resolver usa.
 */
function stubDb(row: Record<string, unknown> | null) {
  return {
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                async maybeSingle() {
                  return { data: row, error: null };
                },
              };
            },
          };
        },
      };
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

/**
 * Stub por-tabela: `getProviderForConversation` consulta `conversations`
 * e, quando `channel_id` é nulo, consulta `whatsapp_channels` de novo
 * (fallback) — este stub devolve uma linha diferente por tabela, com o
 * mesmo encadeamento `select().eq()...maybeSingle()`, incluindo
 * `order()/limit()` (só o fallback os usa).
 */
function stubDbByTable(tables: {
  conversations?: Record<string, unknown> | null;
  whatsapp_channels?: Record<string, unknown> | null;
}) {
  function chain(row: Record<string, unknown> | null | undefined) {
    const node = {
      eq: () => node,
      order: () => node,
      limit: () => node,
      async maybeSingle() {
        return { data: row ?? null, error: null };
      },
    };
    return node;
  }
  return {
    from(table: string) {
      return {
        select() {
          return chain(
            table === "conversations"
              ? tables.conversations
              : tables.whatsapp_channels,
          );
        },
      };
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const metaRow = {
  id: "chan-1",
  account_id: "acc-1",
  provider: "meta",
  status: "connected",
  phone_number_id: "PNID",
  access_token: encrypt("TOKEN-EM-CLARO"),
};

describe("getProviderForChannel", () => {
  it("devolve um adapter da Meta já carregado com a credencial", async () => {
    const provider = await getProviderForChannel(stubDb(metaRow), "chan-1");
    expect(provider.kind).toBe("meta");
  });

  it("lança ChannelNotFoundError quando o canal não existe", async () => {
    await expect(
      getProviderForChannel(stubDb(null), "inexistente"),
    ).rejects.toBeInstanceOf(ChannelNotFoundError);
  });

  it("aceita um canal Meta desconectado — status é bookkeeping de registro (migração 015), não uma sessão viva", async () => {
    // Regressão C2: o código pré-multi-canal nunca checou `status` para a
    // Meta, só exigia um token válido — inclusive `config/route.ts` salva
    // `status: 'disconnected'` de propósito quando o /register falha,
    // esperando que o envio continue funcionando enquanto o usuário tenta
    // de novo. Gatear a Meta em `status` quebraria esse caso real.
    const desconectado = { ...metaRow, status: "disconnected" };
    const provider = await getProviderForChannel(stubDb(desconectado), "chan-1");
    expect(provider.kind).toBe("meta");
  });

  it("recusa um canal UAZAPI desconectado antes de qualquer chamada de rede", async () => {
    // UAZAPI's `connected` reflects a live WebSocket-style session —
    // sending genuinely requires it, unlike Meta's registration flag.
    const uazapiDesconectado = {
      id: "chan-2",
      account_id: "acc-1",
      provider: "uazapi",
      status: "disconnected",
    };
    await expect(
      getProviderForChannel(stubDb(uazapiDesconectado), "chan-2"),
    ).rejects.toBeInstanceOf(ProviderNotConnectedError);
  });

  it("nunca devolve o token ao chamador", async () => {
    const provider = await getProviderForChannel(stubDb(metaRow), "chan-1");
    expect(JSON.stringify(Object.keys(provider))).not.toContain("access_token");
    expect(JSON.stringify(Object.keys(provider))).not.toContain("token");
  });
});

describe("getProviderForConversation", () => {
  it("cai para o canal da conta quando a conversa não tem channel_id (fallback C1)", async () => {
    // Conversas criadas antes do backfill da migração 037, ou criadas
    // pelos call sites de saída (dashboard `send/route.ts`, API pública
    // `resolve-conversation.ts`) que não setam `channel_id` de propósito —
    // devem continuar enviando através do canal único da conta, exatamente
    // como o código pré-multi-canal sempre fez.
    const db = stubDbByTable({
      conversations: { channel_id: null },
      whatsapp_channels: metaRow,
    });
    const provider = await getProviderForConversation(db, "conv-1", "acc-1");
    expect(provider.kind).toBe("meta");
  });

  it("lança NoChannelConfiguredError quando a conta não tem nenhum canal", async () => {
    const db = stubDbByTable({
      conversations: { channel_id: null },
      whatsapp_channels: null,
    });
    await expect(
      getProviderForConversation(db, "conv-1", "acc-1"),
    ).rejects.toBeInstanceOf(NoChannelConfiguredError);
  });

  it("usa o channel_id da conversa diretamente quando ele existe", async () => {
    const db = stubDbByTable({
      conversations: { channel_id: "chan-1" },
      whatsapp_channels: metaRow,
    });
    const provider = await getProviderForConversation(db, "conv-1", "acc-1");
    expect(provider.kind).toBe("meta");
  });
});

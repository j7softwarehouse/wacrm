import { describe, expect, it } from "vitest";
import { encrypt } from "@/lib/whatsapp/encryption";
import { ProviderNotConnectedError } from "./types";
import { ChannelNotFoundError, getProviderForChannel } from "./resolve";

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

  it("recusa canal desconectado antes de qualquer chamada de rede", async () => {
    // Sem isso o atendente escreve, "envia", e a mensagem some.
    const desconectado = { ...metaRow, status: "disconnected" };
    await expect(
      getProviderForChannel(stubDb(desconectado), "chan-1"),
    ).rejects.toBeInstanceOf(ProviderNotConnectedError);
  });

  it("nunca devolve o token ao chamador", async () => {
    const provider = await getProviderForChannel(stubDb(metaRow), "chan-1");
    expect(JSON.stringify(Object.keys(provider))).not.toContain("access_token");
    expect(JSON.stringify(Object.keys(provider))).not.toContain("token");
  });
});

import { describe, expect, it, vi } from "vitest";

import { findOrCreateConversationForContact } from "./find-or-create-conversation";

const mocks = vi.hoisted(() => ({ resolveDefaultChannelId: vi.fn() }));
vi.mock("@/lib/whatsapp/providers/resolve", () => ({
  resolveDefaultChannelId: mocks.resolveDefaultChannelId,
}));

interface FakeRow {
  id: string;
  channel_id: string | null;
}

/**
 * Fake mínimo do query builder do supabase-js: acumula os filtros
 * `.eq()`/`.or()` da cadeia ATUAL e resolve no `await` (a cadeia
 * inteira é "thenable", como o builder real) contra as linhas
 * fornecidas — sem interpretar `.or()` de verdade, só registra que foi
 * chamado (os testes não misturam `.or()` com filtros que precisem de
 * lógica OR real além de "canal X ou canal nulo", que já é o único uso
 * desta função).
 */
function fakeSupabase(options: {
  existingRows?: FakeRow[];
  insertedId?: string;
  healUpdates?: { id: string; channelId: string }[];
  inserts?: Record<string, unknown>[];
}) {
  const { existingRows = [], insertedId = "conv-nova", healUpdates = [], inserts = [] } =
    options;

  return {
    from: (table: string) => {
      if (table !== "conversations") throw new Error(`tabela inesperada: ${table}`);
      const chain = {
        select: () => chain,
        eq: () => chain,
        or: () => chain,
        order: () => chain,
        limit: async () => ({ data: existingRows, error: null }),
        update: (patch: { channel_id: string }) => ({
          eq: (_col: string, id: string) => ({
            is: async () => {
              healUpdates.push({ id, channelId: patch.channel_id });
              return { data: null, error: null };
            },
          }),
        }),
        insert: (row: Record<string, unknown>) => {
          inserts.push(row);
          return {
            select: () => ({
              single: async () => ({ data: { id: insertedId }, error: null }),
            }),
          };
        },
      };
      return chain;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    },
  } as any;
}

describe("findOrCreateConversationForContact", () => {
  it("sem canal explicito: acha a conversa existente no canal padrao da conta", async () => {
    mocks.resolveDefaultChannelId.mockResolvedValue("chan-padrao");
    const healUpdates: { id: string; channelId: string }[] = [];
    const supabase = fakeSupabase({
      existingRows: [{ id: "conv-1", channel_id: "chan-padrao" }],
      healUpdates,
    });

    const id = await findOrCreateConversationForContact(
      supabase,
      "acct-1",
      "user-1",
      "contact-1",
    );

    expect(id).toBe("conv-1");
    expect(healUpdates).toEqual([]);
  });

  it("sem canal explicito: adota (cura) uma conversa orfa existente", async () => {
    mocks.resolveDefaultChannelId.mockResolvedValue("chan-padrao");
    const healUpdates: { id: string; channelId: string }[] = [];
    const supabase = fakeSupabase({
      existingRows: [{ id: "conv-orfa", channel_id: null }],
      healUpdates,
    });

    const id = await findOrCreateConversationForContact(
      supabase,
      "acct-1",
      "user-1",
      "contact-1",
    );

    expect(id).toBe("conv-orfa");
    expect(healUpdates).toEqual([{ id: "conv-orfa", channelId: "chan-padrao" }]);
  });

  it("sem canal explicito: cria uma conversa nova quando nao existe nenhuma", async () => {
    mocks.resolveDefaultChannelId.mockResolvedValue("chan-padrao");
    const inserts: Record<string, unknown>[] = [];
    const supabase = fakeSupabase({ existingRows: [], inserts });

    const id = await findOrCreateConversationForContact(
      supabase,
      "acct-1",
      "user-1",
      "contact-1",
    );

    expect(id).toBe("conv-nova");
    expect(inserts).toEqual([
      {
        account_id: "acct-1",
        user_id: "user-1",
        contact_id: "contact-1",
        channel_id: "chan-padrao",
      },
    ]);
  });

  it("COM canal explicito: acha a conversa existente NESSE canal", async () => {
    const supabase = fakeSupabase({
      existingRows: [{ id: "conv-explicita", channel_id: "chan-b" }],
    });

    const id = await findOrCreateConversationForContact(
      supabase,
      "acct-1",
      "user-1",
      "contact-1",
      "chan-b",
    );

    expect(id).toBe("conv-explicita");
    // Escolha explicita nunca consulta o canal padrao da conta.
    expect(mocks.resolveDefaultChannelId).not.toHaveBeenCalled();
  });

  it("COM canal explicito: NAO adota uma conversa orfa -- cria uma nova no canal escolhido", async () => {
    // O ponto central da regra: diferente do caminho automatico, uma
    // escolha EXPLICITA de canal nunca reaproveita uma conversa sem
    // canal, porque ela pode pertencer de fato a outro numero cujo id
    // foi perdido -- reaproveitar misturaria conversas entre canais.
    const inserts: Record<string, unknown>[] = [];
    const healUpdates: { id: string; channelId: string }[] = [];
    const supabase = fakeSupabase({
      existingRows: [], // a query com .eq('channel_id', 'chan-b') nao acha a orfa
      inserts,
      healUpdates,
    });

    const id = await findOrCreateConversationForContact(
      supabase,
      "acct-1",
      "user-1",
      "contact-1",
      "chan-b",
    );

    expect(id).toBe("conv-nova");
    expect(healUpdates).toEqual([]);
    expect(inserts).toEqual([
      {
        account_id: "acct-1",
        user_id: "user-1",
        contact_id: "contact-1",
        channel_id: "chan-b",
      },
    ]);
  });

  it("devolve null quando a busca falha", async () => {
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              or: () => ({
                order: () => ({
                  limit: async () => ({ data: null, error: { message: "boom" } }),
                }),
              }),
            }),
          }),
        }),
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    mocks.resolveDefaultChannelId.mockResolvedValue("chan-padrao");

    const id = await findOrCreateConversationForContact(
      supabase,
      "acct-1",
      "user-1",
      "contact-1",
    );

    expect(id).toBeNull();
  });
});

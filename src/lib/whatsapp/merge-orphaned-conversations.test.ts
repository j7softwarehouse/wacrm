import { describe, expect, it } from "vitest";

import { mergeOrphanedConversations } from "./merge-orphaned-conversations";

interface FakeConversation {
  id: string;
  contact_id: string;
  channel_id: string | null;
  last_message_text: string | null;
  last_message_at: string | null;
}

function fakeSupabase(
  conversations: FakeConversation[],
  messages: { id: string; conversation_id: string }[],
) {
  const conversationUpdates: Record<string, unknown>[] = [];
  const conversationDeletes: string[] = [];
  const messageUpdates: { conversationId: string; newConversationId: string }[] =
    [];

  return {
    client: {
      from(table: string) {
        if (table === "conversations") {
          return {
            select: () => ({
              eq: (_col: string, _accountId: string) => ({
                returns: async () => ({ data: conversations }),
              }),
            }),
            update: (patch: Record<string, unknown>) => ({
              eq: (_col: string, id: string) => {
                conversationUpdates.push({ id, ...patch });
                return Promise.resolve({ data: null, error: null });
              },
            }),
            delete: () => ({
              eq: (_col: string, id: string) => {
                conversationDeletes.push(id);
                return Promise.resolve({ data: null, error: null });
              },
            }),
          };
        }
        if (table === "messages") {
          return {
            update: (patch: { conversation_id: string }) => ({
              eq: (_col: string, conversationId: string) => {
                messageUpdates.push({
                  conversationId,
                  newConversationId: patch.conversation_id,
                });
                messages
                  .filter((m) => m.conversation_id === conversationId)
                  .forEach((m) => {
                    m.conversation_id = patch.conversation_id;
                  });
                return Promise.resolve({ data: null, error: null });
              },
            }),
          };
        }
        throw new Error(`tabela inesperada: ${table}`);
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    conversationUpdates,
    conversationDeletes,
    messageUpdates,
  };
}

describe("mergeOrphanedConversations", () => {
  it("mescla a conversa do canal removido na conversa órfã do mesmo contato", async () => {
    const conversations: FakeConversation[] = [
      {
        id: "orphan-1",
        contact_id: "contact-1",
        channel_id: null,
        last_message_text: "hi",
        last_message_at: "2026-07-29T01:55:51+00:00",
      },
      {
        id: "channel-conv-1",
        contact_id: "contact-1",
        channel_id: "chan-1",
        last_message_text: "oi gostosão",
        last_message_at: "2026-07-29T01:55:28+00:00",
      },
    ];
    const messages = [{ id: "m1", conversation_id: "channel-conv-1" }];
    const { client, conversationDeletes, messageUpdates, conversationUpdates } =
      fakeSupabase(conversations, messages);

    await mergeOrphanedConversations(client, "acc-1", "chan-1");

    expect(messageUpdates).toEqual([
      { conversationId: "channel-conv-1", newConversationId: "orphan-1" },
    ]);
    expect(conversationDeletes).toEqual(["channel-conv-1"]);
    // A conversa órfã já era mais recente — não atualiza o resumo dela.
    expect(conversationUpdates).toEqual([]);
  });

  it("atualiza o resumo da conversa órfã quando a do canal removido é mais recente", async () => {
    const conversations: FakeConversation[] = [
      {
        id: "orphan-1",
        contact_id: "contact-1",
        channel_id: null,
        last_message_text: "mensagem antiga",
        last_message_at: "2026-01-01T00:00:00+00:00",
      },
      {
        id: "channel-conv-1",
        contact_id: "contact-1",
        channel_id: "chan-1",
        last_message_text: "mensagem nova",
        last_message_at: "2026-07-29T01:55:28+00:00",
      },
    ];
    const { client, conversationUpdates } = fakeSupabase(conversations, []);

    await mergeOrphanedConversations(client, "acc-1", "chan-1");

    expect(conversationUpdates).toEqual([
      {
        id: "orphan-1",
        last_message_text: "mensagem nova",
        last_message_at: "2026-07-29T01:55:28+00:00",
      },
    ]);
  });

  it("não mexe em nada quando não há conversa órfã para o mesmo contato", async () => {
    const conversations: FakeConversation[] = [
      {
        id: "channel-conv-1",
        contact_id: "contact-1",
        channel_id: "chan-1",
        last_message_text: "oi",
        last_message_at: "2026-07-29T01:55:28+00:00",
      },
      {
        id: "other-conv",
        contact_id: "contact-2",
        channel_id: null,
        last_message_text: "outro contato",
        last_message_at: "2026-07-29T01:55:28+00:00",
      },
    ];
    const { client, conversationDeletes, messageUpdates } = fakeSupabase(
      conversations,
      [],
    );

    await mergeOrphanedConversations(client, "acc-1", "chan-1");

    expect(conversationDeletes).toEqual([]);
    expect(messageUpdates).toEqual([]);
  });

  it("ignora canais sem nenhuma conversa (data null)", async () => {
    const client = {
      from: () => ({
        select: () => ({
          eq: () => ({
            returns: async () => ({ data: null }),
          }),
        }),
      }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    await expect(
      mergeOrphanedConversations(client, "acc-1", "chan-1"),
    ).resolves.toBeUndefined();
  });
});

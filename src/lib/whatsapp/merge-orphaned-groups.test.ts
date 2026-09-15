import { describe, expect, it } from "vitest";

import { mergeOrphanedGroups } from "./merge-orphaned-groups";

interface FakeGroup {
  id: string;
  channel_id: string | null;
  group_jid: string;
  name: string | null;
  avatar_url: string | null;
  synced_at: string | null;
}

function fakeSupabase(
  groups: FakeGroup[],
  conversations: { id: string; group_id: string }[],
) {
  const conversationUpdates: { id: string; newGroupId: string }[] = [];
  const groupUpdates: Record<string, unknown>[] = [];
  const groupDeletes: string[] = [];

  return {
    client: {
      from(table: string) {
        if (table === "whatsapp_groups") {
          return {
            select: () => ({
              eq: (_col: string, _accountId: string) => ({
                returns: async () => ({ data: groups }),
              }),
            }),
            update: (patch: Record<string, unknown>) => ({
              eq: (_col: string, id: string) => {
                groupUpdates.push({ id, ...patch });
                return Promise.resolve({ data: null, error: null });
              },
            }),
            delete: () => ({
              eq: (_col: string, id: string) => {
                groupDeletes.push(id);
                return Promise.resolve({ data: null, error: null });
              },
            }),
          };
        }
        if (table === "conversations") {
          return {
            update: (patch: { group_id: string }) => ({
              eq: (_col: string, groupId: string) => {
                conversations
                  .filter((c) => c.group_id === groupId)
                  .forEach((c) => {
                    conversationUpdates.push({ id: c.id, newGroupId: patch.group_id });
                    c.group_id = patch.group_id;
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
    groupUpdates,
    groupDeletes,
  };
}

describe("mergeOrphanedGroups", () => {
  it("mescla o grupo do canal removido no grupo orfao do mesmo group_jid", async () => {
    const groups: FakeGroup[] = [
      {
        id: "orphan-1",
        channel_id: null,
        group_jid: "1@g.us",
        name: "Turma A",
        avatar_url: null,
        synced_at: "2026-08-01T00:00:00+00:00",
      },
      {
        id: "channel-group-1",
        channel_id: "chan-1",
        group_jid: "1@g.us",
        name: "Turma A (novo canal)",
        avatar_url: "https://x/a.png",
        synced_at: "2026-07-01T00:00:00+00:00",
      },
    ];
    const conversations = [{ id: "conv-1", group_id: "channel-group-1" }];
    const { client, conversationUpdates, groupDeletes, groupUpdates } =
      fakeSupabase(groups, conversations);

    await mergeOrphanedGroups(client, "acc-1", "chan-1");

    expect(conversationUpdates).toEqual([{ id: "conv-1", newGroupId: "orphan-1" }]);
    expect(groupDeletes).toEqual(["channel-group-1"]);
    // O órfão já era mais recente (synced_at maior) — não atualiza os dados dele.
    expect(groupUpdates).toEqual([]);
  });

  it("atualiza nome/avatar do orfao quando o grupo do canal removido foi sincronizado depois", async () => {
    const groups: FakeGroup[] = [
      {
        id: "orphan-1",
        channel_id: null,
        group_jid: "1@g.us",
        name: "Nome antigo",
        avatar_url: null,
        synced_at: "2026-01-01T00:00:00+00:00",
      },
      {
        id: "channel-group-1",
        channel_id: "chan-1",
        group_jid: "1@g.us",
        name: "Nome atualizado",
        avatar_url: "https://x/novo.png",
        synced_at: "2026-08-01T00:00:00+00:00",
      },
    ];
    const { client, groupUpdates } = fakeSupabase(groups, []);

    await mergeOrphanedGroups(client, "acc-1", "chan-1");

    expect(groupUpdates).toEqual([
      {
        id: "orphan-1",
        name: "Nome atualizado",
        avatar_url: "https://x/novo.png",
        synced_at: "2026-08-01T00:00:00+00:00",
      },
    ]);
  });

  it("nao mexe em nada quando nao ha grupo orfao com o mesmo group_jid", async () => {
    const groups: FakeGroup[] = [
      {
        id: "channel-group-1",
        channel_id: "chan-1",
        group_jid: "1@g.us",
        name: "Turma A",
        avatar_url: null,
        synced_at: "2026-08-01T00:00:00+00:00",
      },
      {
        id: "other-orphan",
        channel_id: null,
        group_jid: "2@g.us",
        name: "Outro grupo",
        avatar_url: null,
        synced_at: "2026-08-01T00:00:00+00:00",
      },
    ];
    const { client, groupDeletes } = fakeSupabase(groups, []);

    await mergeOrphanedGroups(client, "acc-1", "chan-1");

    expect(groupDeletes).toEqual([]);
  });

  it("ignora contas sem nenhum grupo (data null)", async () => {
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
      mergeOrphanedGroups(client, "acc-1", "chan-1"),
    ).resolves.toBeUndefined();
  });
});

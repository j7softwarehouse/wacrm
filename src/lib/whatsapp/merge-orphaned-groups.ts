// ============================================================
// Evita a colisão de `whatsapp_groups_account_id_channel_id_group_jid_key`
// (migração 20260829000001, NULLS NOT DISTINCT) ao remover um canal.
//
// Mesmo problema já resolvido para `conversations` em
// merge-orphaned-conversations.ts, aqui para `whatsapp_groups`: quando
// um canal é apagado, `whatsapp_groups.channel_id` vira NULL via ON
// DELETE SET NULL. Se o mesmo grupo (mesmo `group_jid`) já tem uma
// linha órfã de um canal removido ANTERIORMENTE, as duas colidiriam em
// (account_id, NULL, group_jid) e o DELETE do canal falha inteiro —
// visto em homolog ao remover um segundo canal UAZAPI duplicado para o
// mesmo número.
//
// A correção mescla o grupo do canal-a-ser-removido no grupo órfão já
// existente ANTES do DELETE do canal, para que o ON DELETE SET NULL
// nunca veja duas linhas concorrendo pelo mesmo slot.
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";

interface MergeableGroup {
  id: string;
  channel_id: string | null;
  group_jid: string;
  name: string | null;
  avatar_url: string | null;
  synced_at: string | null;
}

export async function mergeOrphanedGroups(
  supabase: SupabaseClient,
  accountId: string,
  channelId: string,
): Promise<void> {
  const { data: groups } = await supabase
    .from("whatsapp_groups")
    .select("id, channel_id, group_jid, name, avatar_url, synced_at")
    .eq("account_id", accountId)
    .returns<MergeableGroup[]>();

  if (!groups) return;

  const orphanByJid = new Map(
    groups
      .filter((g) => g.channel_id === null)
      .map((g) => [g.group_jid, g] as const),
  );

  const toMerge = groups.filter(
    (g) => g.channel_id === channelId && orphanByJid.has(g.group_jid),
  );

  for (const group of toMerge) {
    const orphan = orphanByJid.get(group.group_jid);
    if (!orphan) continue;

    // Conversas de grupo apontam para `whatsapp_groups.id` — sem
    // repontar isso primeiro, elas ficariam presas a um id que está
    // prestes a ser apagado.
    await supabase
      .from("conversations")
      .update({ group_id: orphan.id })
      .eq("group_id", group.id);

    const groupIsNewer =
      group.synced_at !== null &&
      (orphan.synced_at === null || group.synced_at > orphan.synced_at);

    if (groupIsNewer) {
      await supabase
        .from("whatsapp_groups")
        .update({
          name: group.name,
          avatar_url: group.avatar_url,
          synced_at: group.synced_at,
        })
        .eq("id", orphan.id);
    }

    await supabase.from("whatsapp_groups").delete().eq("id", group.id);
  }
}

// ============================================================
// Evita a colisão de `idx_conversations_account_contact_channel`
// (migração 037, NULLS NOT DISTINCT) ao remover um canal.
//
// Quando um canal é apagado, `conversations.channel_id` vira NULL via
// ON DELETE SET NULL (histórico preservado). Se o mesmo contato já
// tem uma conversa órfã de um canal removido ANTERIORMENTE, as duas
// colidiriam em (account_id, contact_id, NULL) e o DELETE inteiro
// falha com "duplicate key value violates unique constraint" — visto
// em produção ao remover um segundo canal UAZAPI de teste.
//
// A correção mescla a conversa do canal-a-ser-removido na conversa
// órfã já existente ANTES do DELETE do canal, para que o ON DELETE SET
// NULL nunca veja duas linhas concorrendo pelo mesmo slot.
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";

interface MergeableConversation {
  id: string;
  contact_id: string;
  channel_id: string | null;
  last_message_text: string | null;
  last_message_at: string | null;
}

export async function mergeOrphanedConversations(
  supabase: SupabaseClient,
  accountId: string,
  channelId: string,
): Promise<void> {
  const { data: conversations } = await supabase
    .from("conversations")
    .select("id, contact_id, channel_id, last_message_text, last_message_at")
    .eq("account_id", accountId)
    .returns<MergeableConversation[]>();

  if (!conversations) return;

  const orphanByContact = new Map(
    conversations
      .filter((c) => c.channel_id === null)
      .map((c) => [c.contact_id, c] as const),
  );

  const toMerge = conversations.filter(
    (c) => c.channel_id === channelId && orphanByContact.has(c.contact_id),
  );

  for (const conv of toMerge) {
    const orphan = orphanByContact.get(conv.contact_id);
    if (!orphan) continue;

    await supabase
      .from("messages")
      .update({ conversation_id: orphan.id })
      .eq("conversation_id", conv.id);

    const convIsNewer =
      conv.last_message_at !== null &&
      (orphan.last_message_at === null ||
        conv.last_message_at > orphan.last_message_at);

    if (convIsNewer) {
      await supabase
        .from("conversations")
        .update({
          last_message_text: conv.last_message_text,
          last_message_at: conv.last_message_at,
        })
        .eq("id", orphan.id);
    }

    await supabase.from("conversations").delete().eq("id", conv.id);
  }
}

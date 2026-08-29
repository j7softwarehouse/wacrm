// ============================================================
// Resolve a conversa de um grupo e o participante que escreveu.
//
// Espelha `resolve-conversation.ts`, que serve o caminho 1:1. A
// diferença central: grupo é opt-in. Grupo desconhecido é registrado
// desabilitado e a mensagem é descartada, para a tela de seleção
// descobrir o que existe sem poluir a inbox.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

export interface ResolvedGroupConversation {
  conversationId: string;
  groupId: string;
  participantId: string;
}

/** `5511999999999@s.whatsapp.net` → `5511999999999`; `...@lid` → null. */
export function phoneFromParticipantJid(jid: string): string | null {
  if (!jid.endsWith('@s.whatsapp.net')) return null;
  const [user] = jid.split('@');
  if (!user) return null;
  const [phone] = user.split(':');
  return phone || null;
}

export async function resolveGroupConversation(
  db: SupabaseClient,
  accountId: string,
  channelId: string,
  userId: string,
  group: { groupJid: string; participantJid: string; participantName?: string },
): Promise<ResolvedGroupConversation | null> {
  const { data: existing } = await db
    .from('whatsapp_groups')
    .select('id, enabled')
    .eq('account_id', accountId)
    .eq('channel_id', channelId)
    .eq('group_jid', group.groupJid)
    .maybeSingle();

  let groupId: string;
  let enabled: boolean;

  if (!existing) {
    const { data: created, error } = await db
      .from('whatsapp_groups')
      .insert({
        account_id: accountId,
        channel_id: channelId,
        group_jid: group.groupJid,
        enabled: false,
      })
      .select('id')
      .single();
    if (error || !created) return null;
    groupId = created.id;
    enabled = false;
  } else {
    groupId = existing.id;
    enabled = existing.enabled;
  }

  // Grupo não habilitado: já está registrado para a tela de seleção,
  // mas a mensagem não entra na inbox.
  if (!enabled) return null;

  // Upsert: o mesmo participante escreve várias vezes no mesmo grupo.
  // UNIQUE (group_id, participant_jid) faria um insert cego violar a
  // constraint a partir da segunda mensagem — silenciosamente, porque
  // o erro não era checado.
  const { data: participant, error: participantError } = await db
    .from('group_participants')
    .upsert(
      {
        group_id: groupId,
        participant_jid: group.participantJid,
        phone: phoneFromParticipantJid(group.participantJid),
        display_name: group.participantName ?? null,
      },
      { onConflict: 'group_id,participant_jid' },
    )
    .select('id')
    .single();
  if (participantError || !participant) return null;

  // Find-or-create: idx_conversations_account_group_channel permite no
  // máximo uma conversa por (account_id, group_id, channel_id). Um
  // insert cego faria toda mensagem a partir da segunda no mesmo grupo
  // (de qualquer participante) violar a constraint.
  const { data: existingConversation } = await db
    .from('conversations')
    .select('id')
    .eq('account_id', accountId)
    .eq('group_id', groupId)
    .eq('channel_id', channelId)
    .maybeSingle();

  let conversationId: string;
  if (existingConversation) {
    conversationId = existingConversation.id;
  } else {
    const { data: created, error } = await db
      .from('conversations')
      .insert({
        account_id: accountId,
        user_id: userId,
        contact_id: null,
        group_id: groupId,
        channel_id: channelId,
      })
      .select('id')
      .single();
    if (error || !created) return null;
    conversationId = created.id;
  }

  return { conversationId, groupId, participantId: participant.id };
}

// ============================================================
// Resolve a conversa de um grupo e o participante que escreveu.
//
// Espelha `resolve-conversation.ts`, que serve o caminho 1:1. A
// diferença central: grupo é opt-in. Grupo desconhecido é registrado
// desabilitado e a mensagem é descartada, para a tela de seleção
// descobrir o que existe sem poluir a inbox.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

import { isUniqueViolation } from '@/lib/contacts/dedupe';

export interface ResolvedGroupConversation {
  conversationId: string;
  groupId: string;
  participantId: string;
  /** `unread_count` atual da conversa, ANTES desta mensagem — o chamador
   *  soma 1 antes de gravar, mesmo padrão do caminho 1:1. */
  unreadCount: number;
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
  // Busca TODAS as linhas deste grupo na conta (não só a do canal atual):
  // necessário pra curar uma linha ÓRFÃ (channel_id nulo, deixada por um
  // canal recriado/removido — ver [[wacrm-canal-identidade-telefone]])
  // em vez de criar uma segunda linha desabilitada e descartar a
  // mensagem em silêncio. Achado ao vivo em 2026-09-15: a instância
  // UAZAPI de homolog foi recriada várias vezes na mesma sessão, e todo
  // grupo antes habilitado virou órfão — cada mensagem nova passou a
  // criar uma linha nova e desabilitada pro canal atual, com a órfã
  // (ainda mostrada como "ligada" na tela de Configurações) nunca mais
  // recebendo nada.
  const { data: rows, error: findError } = await db
    .from('whatsapp_groups')
    .select('id, channel_id, enabled')
    .eq('account_id', accountId)
    .eq('group_jid', group.groupJid);

  if (findError) return null;

  const rowsList = rows ?? [];
  const current = rowsList.find((r) => r.channel_id === channelId) ?? null;
  const orphan = rowsList.find((r) => r.channel_id === null) ?? null;

  let groupId: string;
  let enabled: boolean;

  if (orphan) {
    // A órfã é a fonte de verdade (enabled, histórico) de antes do canal
    // ser recriado. Se já existe uma linha ruim pro canal atual (criada
    // por uma mensagem que chegou ANTES desta cura existir), funde as
    // duas — mesma lógica de merge-orphaned-groups.ts, só que aqui é a
    // ÓRFÃ que sobrevive (ela é quem carrega o enabled/histórico real).
    if (current && current.id !== orphan.id) {
      await db
        .from('conversations')
        .update({ group_id: orphan.id })
        .eq('group_id', current.id);
      await db.from('whatsapp_groups').delete().eq('id', current.id);
    }
    // `.is('channel_id', null)` torna isto um no-op se outro processo já
    // curou a mesma linha entre o SELECT acima e este UPDATE.
    await db
      .from('conversations')
      .update({ channel_id: channelId })
      .eq('group_id', orphan.id)
      .is('channel_id', null);
    await db
      .from('whatsapp_groups')
      .update({ channel_id: channelId })
      .eq('id', orphan.id)
      .is('channel_id', null);
    groupId = orphan.id;
    enabled = orphan.enabled;
  } else if (current) {
    groupId = current.id;
    enabled = current.enabled;
  } else {
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
        ...(group.participantName ? { display_name: group.participantName } : {}),
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
    .select('id, unread_count')
    .eq('account_id', accountId)
    .eq('group_id', groupId)
    .eq('channel_id', channelId)
    .maybeSingle();

  let conversationId: string;
  let unreadCount: number;
  if (existingConversation) {
    conversationId = existingConversation.id;
    unreadCount = existingConversation.unread_count ?? 0;
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
      .select('id, unread_count')
      .single();
    if (error) {
      // Perdeu uma corrida: o clique em "Conversar"
      // (findOrCreateConversationForGroup) pode resolver "não existe
      // ainda" ao mesmo tempo que uma mensagem recebida chega por aqui —
      // idx_conversations_account_group_channel rejeita o segundo insert.
      // Sem reaproveitar a linha vencedora, a mensagem seria descartada
      // (chamador trata `null` como "nada a fazer") — pior que o erro
      // genérico do lado do botão.
      if (isUniqueViolation(error)) {
        const { data: raced } = await db
          .from('conversations')
          .select('id, unread_count')
          .eq('account_id', accountId)
          .eq('group_id', groupId)
          .eq('channel_id', channelId)
          .maybeSingle();
        if (raced) {
          return {
            conversationId: raced.id,
            groupId,
            participantId: participant.id,
            unreadCount: raced.unread_count ?? 0,
          };
        }
      }
      return null;
    }
    if (!created) return null;
    conversationId = created.id;
    unreadCount = created.unread_count ?? 0;
  }

  return { conversationId, groupId, participantId: participant.id, unreadCount };
}

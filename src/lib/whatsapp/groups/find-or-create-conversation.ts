import type { createClient } from '@/lib/supabase/server';
import { isUniqueViolation } from '@/lib/contacts/dedupe';

type FindOrCreateSupabase = Awaited<ReturnType<typeof createClient>>;

/**
 * Return the group's conversation id in this account, creating one if it
 * doesn't exist yet. Mirrors `findOrCreateConversationForContact` (mesmo
 * find-or-create do botão "Conversar" de Contatos), mas mais simples: um
 * grupo já tem `channel_id` fixo na própria linha (não muda de canal), então
 * não há passo de "resolver canal padrão" nem healing de `channel_id` nulo.
 *
 * `idx_conversations_account_group_channel` permite no máximo uma conversa
 * por (account_id, group_id, channel_id) — o find-or-create evita duplicar
 * ao correr depois do webhook já ter criado a conversa (ou vice-versa).
 *
 * Backs the Settings → Grupos "Conversar" button: abre/cria a conversa sem
 * mandar nada, para o usuário digitar a primeira mensagem no Inbox.
 */
export async function findOrCreateConversationForGroup(
  supabase: FindOrCreateSupabase,
  accountId: string,
  userId: string,
  groupId: string,
  channelId: string,
): Promise<string | null> {
  const { data: existing, error: findError } = await supabase
    .from('conversations')
    .select('id')
    .eq('account_id', accountId)
    .eq('group_id', groupId)
    .eq('channel_id', channelId)
    .maybeSingle();

  if (findError) {
    console.error('Error finding conversation for group open:', findError.message);
    return null;
  }

  if (existing) {
    return existing.id;
  }

  const { data: created, error } = await supabase
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

  if (error) {
    // Perdeu uma corrida: o clique em "Conversar" e uma entrega de
    // mensagem recebida via webhook (resolveGroupConversation) podem
    // resolver "não existe ainda" ao mesmo tempo para o mesmo grupo —
    // idx_conversations_account_group_channel rejeita o segundo insert.
    // Re-resolve a linha vencedora em vez de devolver null (espelha o
    // find-or-create de contato/1:1 em ingest.ts).
    if (isUniqueViolation(error)) {
      const { data: raced } = await supabase
        .from('conversations')
        .select('id')
        .eq('account_id', accountId)
        .eq('group_id', groupId)
        .eq('channel_id', channelId)
        .maybeSingle();
      if (raced) return raced.id;
    }
    console.error('Error creating conversation for group open:', error.message);
    return null;
  }

  if (!created) return null;

  return created.id;
}

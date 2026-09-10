import { NextResponse } from 'next/server';

import { createClient } from '@/lib/supabase/server';
import { findOrCreateConversationForGroup } from '@/lib/whatsapp/groups/find-or-create-conversation';

// ============================================================
// POST /api/whatsapp/groups/[id]/open — backs the Settings → Grupos
// "Conversar" button: find-or-create the group's conversation and hand
// back its id so the UI can jump straight to /inbox?c=<id> — no message
// is sent here. Mirrors /api/whatsapp/conversations/open (o mesmo botão
// para Contatos): sem exigir canEditSettings, qualquer membro da conta
// pode abrir uma conversa que já existe (ou criar a primeira).
//
// Um grupo desabilitado (não está na caixa de entrada) ou já abandonado
// (`left_at`) não pode ganhar conversa nova por aqui — resolveGroupConversation
// (webhook) já trata "desabilitado" como "não entra na inbox", e abrir uma
// conversa para mandar mensagem num grupo de onde o número já saiu não faz
// sentido (send-message.ts recusaria de qualquer forma).
// ============================================================

type GroupsSupabase = Awaited<ReturnType<typeof createClient>>;

async function resolveAccountId(
  supabase: GroupsSupabase,
  userId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('account_id')
    .eq('user_id', userId)
    .maybeSingle();

  if (error || !data?.account_id) return null;
  return data.account_id as string;
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const accountId = await resolveAccountId(supabase, user.id);
    if (!accountId) {
      return NextResponse.json(
        { error: 'Your profile is not linked to an account.' },
        { status: 403 },
      );
    }

    const { data: group, error: groupErr } = await supabase
      .from('whatsapp_groups')
      .select('id, channel_id, enabled, left_at')
      .eq('id', id)
      .eq('account_id', accountId)
      .maybeSingle();

    if (groupErr || !group) {
      return NextResponse.json({ error: 'Group not found' }, { status: 404 });
    }

    if (!group.enabled || group.left_at) {
      return NextResponse.json(
        { error: 'Group is not available for a new conversation' },
        { status: 400 },
      );
    }

    const conversationId = await findOrCreateConversationForGroup(
      supabase,
      accountId,
      user.id,
      group.id as string,
      group.channel_id as string,
    );
    if (!conversationId) {
      return NextResponse.json(
        { error: 'Failed to open a conversation for this group' },
        { status: 500 },
      );
    }

    return NextResponse.json({ conversation_id: conversationId });
  } catch (error) {
    console.error('Error in POST .../groups/[id]/open:', error);
    return NextResponse.json({ error: 'Failed to open conversation' }, { status: 500 });
  }
}

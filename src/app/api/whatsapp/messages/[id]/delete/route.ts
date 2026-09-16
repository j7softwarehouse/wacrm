import { NextResponse } from 'next/server';

import { createClient } from '@/lib/supabase/server';
import { canEditSettings, isAccountRole, type AccountRole } from '@/lib/auth/roles';
import {
  getProviderForConversation,
  ChannelNotFoundError,
  NoChannelConfiguredError,
} from '@/lib/whatsapp/providers/resolve';
import { ProviderError } from '@/lib/whatsapp/providers/types';

// ============================================================
// POST /api/whatsapp/messages/[id]/delete — apaga (para todos, no
// WhatsApp) uma mensagem que o PRÓPRIO atendente enviou. NUNCA toca
// `content_text` — só marca deleted_at/deleted_by; a UI decide
// exibir um placeholder. Só canal uazapi.
// ============================================================

type MessagesSupabase = Awaited<ReturnType<typeof createClient>>;

interface CallerProfile {
  accountId: string;
  role: AccountRole | null;
}

async function resolveCallerProfile(
  supabase: MessagesSupabase,
  userId: string,
): Promise<CallerProfile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('account_id, account_role')
    .eq('user_id', userId)
    .maybeSingle();

  if (error || !data?.account_id) return null;

  return {
    accountId: data.account_id as string,
    role: isAccountRole(data.account_role) ? data.account_role : null,
  };
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

    const profile = await resolveCallerProfile(supabase, user.id);
    if (!profile) {
      return NextResponse.json(
        { error: 'Your profile is not linked to an account.' },
        { status: 403 },
      );
    }

    const { data: message, error: msgError } = await supabase
      .from('messages')
      .select('id, conversation_id, sender_type, sender_id, message_id, deleted_at')
      .eq('id', id)
      .maybeSingle();

    if (msgError || !message) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 });
    }

    if (message.sender_type !== 'agent' && message.sender_type !== 'bot') {
      return NextResponse.json(
        { error: 'Only messages sent by the CRM can be deleted.' },
        { status: 400 },
      );
    }
    if (message.deleted_at) {
      return NextResponse.json(
        { error: 'This message was already deleted.' },
        { status: 400 },
      );
    }
    if (!message.message_id) {
      return NextResponse.json(
        { error: 'This message was never delivered to WhatsApp.' },
        { status: 400 },
      );
    }

    const isAuthor = message.sender_id === user.id;
    if (!isAuthor && !canEditSettings(profile.role ?? 'viewer')) {
      return NextResponse.json(
        { error: 'You can only delete your own messages.' },
        { status: 403 },
      );
    }

    const { data: conversation, error: convError } = await supabase
      .from('conversations')
      .select('id, account_id')
      .eq('id', message.conversation_id)
      .eq('account_id', profile.accountId)
      .maybeSingle();

    if (convError || !conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }

    let provider;
    try {
      provider = await getProviderForConversation(
        supabase,
        conversation.id,
        profile.accountId,
      );
    } catch (err) {
      if (err instanceof NoChannelConfiguredError || err instanceof ChannelNotFoundError) {
        return NextResponse.json({ error: 'WhatsApp not configured.' }, { status: 400 });
      }
      throw err;
    }

    if (provider.kind !== 'uazapi') {
      return NextResponse.json(
        { error: 'Deleting messages is only available on uazapi channels.' },
        { status: 400 },
      );
    }

    try {
      await provider.deleteMessage({ messageId: message.message_id });
    } catch (err) {
      const reason = err instanceof ProviderError ? err.message : 'Unknown provider error';
      return NextResponse.json({ error: reason }, { status: 502 });
    }

    // `content_text` NUNCA aparece aqui — é o requisito central do
    // usuário (manter no banco, esconder só no front).
    const { error: updateError } = await supabase
      .from('messages')
      .update({
        deleted_at: new Date().toISOString(),
        deleted_by: user.id,
      })
      .eq('id', id);

    if (updateError) {
      return NextResponse.json(
        { error: 'Message deleted on WhatsApp but failed to update in the database.' },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error in POST .../messages/[id]/delete:', error);
    return NextResponse.json({ error: 'Failed to delete message' }, { status: 500 });
  }
}

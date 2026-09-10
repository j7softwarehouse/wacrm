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
// POST /api/whatsapp/messages/[id]/edit — edita o texto de uma
// mensagem que o PRÓPRIO atendente enviou. Só canal uazapi (a Meta
// Cloud API não suporta editar mensagem enviada — ver
// providers/meta.ts). Body: { text: string }.
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
  request: Request,
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

    const body = await request.json().catch(() => ({}));
    const text = typeof body?.text === 'string' ? body.text.trim() : '';
    if (!text) {
      return NextResponse.json({ error: 'text is required' }, { status: 400 });
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
      .select(
        'id, conversation_id, sender_type, sender_id, content_type, content_text, message_id, deleted_at, original_content_text',
      )
      .eq('id', id)
      .maybeSingle();

    if (msgError || !message) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 });
    }

    // Elegibilidade — antes de qualquer checagem de permissão ou
    // chamada ao provider (Global Constraint da spec).
    if (message.sender_type !== 'agent' && message.sender_type !== 'bot') {
      return NextResponse.json(
        { error: 'Only messages sent by the CRM can be edited.' },
        { status: 400 },
      );
    }
    if (message.content_type !== 'text') {
      return NextResponse.json(
        { error: 'Only plain text messages can be edited.' },
        { status: 400 },
      );
    }
    if (message.deleted_at) {
      return NextResponse.json(
        { error: 'This message was deleted and cannot be edited.' },
        { status: 400 },
      );
    }
    if (!message.message_id) {
      return NextResponse.json(
        { error: 'This message was never delivered to WhatsApp.' },
        { status: 400 },
      );
    }

    // Permissão: autor original, ou admin/owner da conta.
    const isAuthor = message.sender_id === user.id;
    if (!isAuthor && !canEditSettings(profile.role ?? 'viewer')) {
      return NextResponse.json(
        { error: 'You can only edit your own messages.' },
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
        { error: 'Editing messages is only available on uazapi channels.' },
        { status: 400 },
      );
    }

    try {
      await provider.editMessage({ messageId: message.message_id, text });
    } catch (err) {
      const reason = err instanceof ProviderError ? err.message : 'Unknown provider error';
      return NextResponse.json({ error: reason }, { status: 502 });
    }

    const { data: updated, error: updateError } = await supabase
      .from('messages')
      .update({
        content_text: text,
        edited_at: new Date().toISOString(),
        original_content_text: message.original_content_text ?? message.content_text,
      })
      .eq('id', id)
      .select()
      .single();

    if (updateError) {
      return NextResponse.json(
        { error: 'Message edited on WhatsApp but failed to update in the database.' },
        { status: 500 },
      );
    }

    return NextResponse.json({ message: updated });
  } catch (error) {
    console.error('Error in POST .../messages/[id]/edit:', error);
    return NextResponse.json({ error: 'Failed to edit message' }, { status: 500 });
  }
}

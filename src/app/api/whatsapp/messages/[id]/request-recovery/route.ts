import { NextResponse } from 'next/server';

import { createClient } from '@/lib/supabase/server';
import { canEditSettings, isAccountRole, type AccountRole } from '@/lib/auth/roles';
import {
  getProviderForConversation,
  ChannelNotFoundError,
  NoChannelConfiguredError,
} from '@/lib/whatsapp/providers/resolve';
import { ProviderError, ProviderUnsupportedError } from '@/lib/whatsapp/providers/types';

// ============================================================
// POST /api/whatsapp/messages/[id]/request-recovery
//
// Pede ao WhatsApp que reenvie uma mensagem RECEBIDA cujo conteúdo não
// pôde ser lido (uma mensagem "[Undecryptable]" — criptografia
// multiaparelho dessincronizada, falha conhecida do próprio WhatsApp
// multiaparelho, confirmada em produção em 15+ casos desde 15/09, não
// bug deste CRM). Usa /message/history-sync em mode=exact, que a
// própria doc da uazapi marca como "em teste" — pode não funcionar,
// principalmente se o celular do número estiver offline.
//
// A mensagem recuperada (se vier) chega depois por um evento de
// webhook `history` separado — esta rota só confirma que o PEDIDO foi
// aceito, nunca devolve o conteúdo em si.
//
// Admin-only: é uma ação experimental com efeito colateral na sessão
// real do WhatsApp (pede reenvio de verdade), não uma ação de
// atendimento do dia a dia disponível pra qualquer agente.
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

    if (!canEditSettings(profile.role ?? 'viewer')) {
      return NextResponse.json(
        { error: 'Only account admins can request message recovery.' },
        { status: 403 },
      );
    }

    const { data: message, error: msgError } = await supabase
      .from('messages')
      .select('id, conversation_id, sender_type, message_id')
      .eq('id', id)
      .maybeSingle();

    if (msgError || !message) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 });
    }

    if (message.sender_type !== 'customer') {
      return NextResponse.json(
        { error: 'Only messages received from a customer can be recovered.' },
        { status: 400 },
      );
    }
    if (!message.message_id) {
      return NextResponse.json(
        { error: 'This message has no WhatsApp id to recover.' },
        { status: 400 },
      );
    }

    const { data: conversation, error: convError } = await supabase
      .from('conversations')
      .select('id, account_id, group_id, contact_id')
      .eq('id', message.conversation_id)
      .eq('account_id', profile.accountId)
      .maybeSingle();

    if (convError || !conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }

    // chatId: JID do grupo ou telefone do contato — é o identificador
    // que a uazapi usa como "number" pra localizar o chat de origem.
    let chatId: string | null = null;
    if (conversation.group_id) {
      const { data: group } = await supabase
        .from('whatsapp_groups')
        .select('group_jid')
        .eq('id', conversation.group_id as string)
        .maybeSingle();
      chatId = (group?.group_jid as string | undefined) ?? null;
    } else if (conversation.contact_id) {
      const { data: contact } = await supabase
        .from('contacts')
        .select('phone')
        .eq('id', conversation.contact_id as string)
        .maybeSingle();
      chatId = (contact?.phone as string | undefined) ?? null;
    }

    if (!chatId) {
      return NextResponse.json(
        { error: 'Could not resolve the chat this message belongs to.' },
        { status: 400 },
      );
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

    try {
      await provider.requestMessageRecovery({ messageId: message.message_id, chatId });
    } catch (err) {
      if (err instanceof ProviderUnsupportedError) {
        return NextResponse.json(
          { error: 'Message recovery is only available on uazapi channels.' },
          { status: 400 },
        );
      }
      const reason = err instanceof ProviderError ? err.message : 'Unknown provider error';
      return NextResponse.json({ error: reason }, { status: 502 });
    }

    return NextResponse.json({ requested: true });
  } catch (error) {
    console.error('Error in POST .../messages/[id]/request-recovery:', error);
    return NextResponse.json(
      { error: 'Failed to request message recovery' },
      { status: 500 },
    );
  }
}

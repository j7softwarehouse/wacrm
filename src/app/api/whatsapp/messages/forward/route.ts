import { NextResponse } from 'next/server';

import { createClient } from '@/lib/supabase/server';
import { MEDIA_KINDS } from '@/lib/whatsapp/send-message';
import { forwardOneMessage, type ForwardableMessage } from '@/lib/whatsapp/forward-message';
import { resolveDefaultChannelId } from '@/lib/whatsapp/providers/resolve';
import { resolveChannelPhone } from '@/lib/whatsapp/channel-identity';
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit';
import { MAX_FORWARD_DESTINATIONS, MAX_FORWARD_MESSAGES } from '@/lib/whatsapp/forward-limits';

// ============================================================
// POST /api/whatsapp/messages/forward — encaminha UMA OU VÁRIAS
// mensagens (até MAX_FORWARD_MESSAGES) para uma ou várias conversas
// (até MAX_FORWARD_DESTINATIONS), igual ao "selecionar várias e
// encaminhar" do WhatsApp. Body: { messageIds: string[],
// conversationIds: string[], note?: string }.
//
// Substitui a antiga api/whatsapp/messages/[id]/forward/route.ts (uma
// mensagem só) — o caso de 1 mensagem é só messageIds com 1 item.
//
// Entrega DESTINO por fora, MENSAGEM por dentro: cada destino recebe o
// pacote inteiro, na ordem cronológica original, antes do próximo
// destino começar. Isso é deliberado — se o limite de taxa do provedor
// bater no meio, alguns destinos já têm o pacote completo e os
// demais nada, em vez de TODOS os destinos ficarem com um pacote pela
// metade.
//
// O disjuntor de limite de taxa cobre o LOTE INTEIRO (todas as
// combinações mensagem×destino), não só a mensagem atual — insistir
// depois de um rate limit do provedor é o que leva o número ao
// banimento, e agora o pior caso é maior (até 25 envios numa
// requisição, ver forward-limits.ts).
//
// Nota opcional só se aplica quando UMA mensagem está sendo
// encaminhada — com 2+ é ambíguo em qual balão ela entraria, então é
// ignorada (mesma regra que o ForwardDialog já aplica escondendo o
// campo).
// ============================================================

const FORWARDABLE_TYPES = ['text', ...MEDIA_KINDS] as const;

interface ForwardResult {
  messageId: string;
  conversationId: string;
  ok: boolean;
  error?: string;
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const limit = checkRateLimit(`forward:${user.id}`, RATE_LIMITS.forward);
    if (!limit.success) {
      return rateLimitResponse(limit);
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('account_id')
      .eq('user_id', user.id)
      .maybeSingle();

    if (!profile?.account_id) {
      return NextResponse.json(
        { error: 'Your profile is not linked to an account.' },
        { status: 403 },
      );
    }
    const accountId = profile.account_id as string;

    const body = await request.json().catch(() => ({}));
    const messageIds: string[] = Array.isArray(body?.messageIds)
      ? body.messageIds.filter((m: unknown) => typeof m === 'string')
      : [];
    const conversationIds: string[] = Array.isArray(body?.conversationIds)
      ? body.conversationIds.filter((c: unknown) => typeof c === 'string')
      : [];
    const rawNote: string = typeof body?.note === 'string' ? body.note.trim() : '';

    if (messageIds.length === 0) {
      return NextResponse.json(
        { error: 'At least one message is required' },
        { status: 400 },
      );
    }
    if (messageIds.length > MAX_FORWARD_MESSAGES) {
      return NextResponse.json(
        { error: `At most ${MAX_FORWARD_MESSAGES} messages are allowed` },
        { status: 400 },
      );
    }
    if (conversationIds.length === 0) {
      return NextResponse.json(
        { error: 'At least one destination conversation is required' },
        { status: 400 },
      );
    }
    if (conversationIds.length > MAX_FORWARD_DESTINATIONS) {
      return NextResponse.json(
        { error: `At most ${MAX_FORWARD_DESTINATIONS} destinations are allowed` },
        { status: 400 },
      );
    }
    // Nota só faz sentido presa a UMA mensagem — com o lote inteiro,
    // ignorar em vez de recusar (o ForwardDialog já esconde o campo
    // nesse caso; um cliente que mande mesmo assim não trava a
    // requisição por causa disso).
    const note = messageIds.length === 1 ? rawNote : '';

    const { data: messageRows } = await supabase
      .from('messages')
      .select('id, conversation_id, content_type, content_text, media_url, deleted_at, created_at')
      .in('id', messageIds);

    const foundById = new Map((messageRows ?? []).map((m) => [m.id as string, m]));
    if (messageIds.some((id) => !foundById.has(id))) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 });
    }

    const messages = messageIds.map((id) => foundById.get(id)!);

    // Todas do MESMO chat de origem — é assim que a seleção múltipla
    // acontece na prática (dentro de uma conversa aberta), e simplifica
    // a checagem de posse/canal para UMA resolução em vez de uma por
    // mensagem.
    const sourceConversationId = messages[0].conversation_id as string;
    if (messages.some((m) => m.conversation_id !== sourceConversationId)) {
      return NextResponse.json(
        { error: 'All messages must belong to the same conversation' },
        { status: 400 },
      );
    }

    for (const message of messages) {
      if (message.deleted_at) {
        return NextResponse.json(
          { error: 'This message was deleted and cannot be forwarded.' },
          { status: 400 },
        );
      }
      const contentType = message.content_type as string;
      if (!FORWARDABLE_TYPES.includes(contentType as (typeof FORWARDABLE_TYPES)[number])) {
        return NextResponse.json(
          { error: 'This kind of message cannot be forwarded.' },
          { status: 400 },
        );
      }
      const isMedia = (MEDIA_KINDS as readonly string[]).includes(contentType);
      // Vídeo com mais de 48h tem o arquivo apagado do storage e o
      // `media_url` zerado (retenção de mídia) — não dá para encaminhar
      // o que não existe mais do nosso lado.
      if (isMedia && !message.media_url) {
        return NextResponse.json(
          { error: 'The media for this message is no longer available.' },
          { status: 400 },
        );
      }
      if (contentType === 'text' && !message.content_text) {
        return NextResponse.json(
          { error: 'This message has no content to forward.' },
          { status: 400 },
        );
      }
    }

    // Tenancy da ORIGEM: sem isto, um id de mensagem de outra conta
    // viraria conteúdo encaminhável para dentro desta conta.
    const { data: sourceConversation } = await supabase
      .from('conversations')
      .select('id, channel_id')
      .eq('id', sourceConversationId)
      .eq('account_id', accountId)
      .maybeSingle();

    if (!sourceConversation) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 });
    }

    // Tenancy do DESTINO + MESMO CANAL (mesmo NÚMERO) da origem — ver
    // channel-identity.ts para o porquê de comparar por telefone, não
    // por id de canal bruto.
    const [defaultChannelId, { data: accountChannels }] = await Promise.all([
      resolveDefaultChannelId(supabase, accountId),
      supabase.from('whatsapp_channels').select('id, phone_e164').eq('account_id', accountId),
    ]);
    const phoneByChannelId = new Map(
      (accountChannels ?? []).map((c) => [c.id as string, c.phone_e164 as string | null]),
    );
    const sourcePhone = resolveChannelPhone(
      (sourceConversation.channel_id as string | null) ?? null,
      phoneByChannelId,
      defaultChannelId,
    );

    const { data: destinationRows } = await supabase
      .from('conversations')
      .select('id, channel_id')
      .eq('account_id', accountId)
      .in('id', conversationIds);

    const allowed = new Set(
      (destinationRows ?? [])
        .filter(
          (d) =>
            sourcePhone !== null &&
            resolveChannelPhone(d.channel_id as string | null, phoneByChannelId, defaultChannelId) ===
              sourcePhone,
        )
        .map((d) => d.id as string),
    );
    const unknown = conversationIds.filter((c) => !allowed.has(c));
    if (unknown.length > 0) {
      return NextResponse.json(
        { error: 'One or more destination conversations were not found' },
        { status: 400 },
      );
    }

    // Ordem cronológica original — não a ordem em que o body listou os
    // ids (a seleção na tela pode ter sido clicada fora de ordem).
    const orderedMessages = [...messages].sort(
      (a, b) =>
        new Date(a.created_at as string).getTime() - new Date(b.created_at as string).getTime(),
    ) as unknown as ForwardableMessage[];

    const results: ForwardResult[] = [];
    let stoppedByRateLimit = false;

    for (const destinationId of conversationIds) {
      for (const message of orderedMessages) {
        if (stoppedByRateLimit) {
          results.push({
            messageId: message.id,
            conversationId: destinationId,
            ok: false,
            error: 'Skipped: WhatsApp rate limit reached.',
          });
          continue;
        }
        const outcome = await forwardOneMessage(
          supabase,
          accountId,
          user.id,
          message,
          destinationId,
          note || undefined,
        );
        if (!outcome.ok) {
          results.push({
            messageId: message.id,
            conversationId: destinationId,
            ok: false,
            error: outcome.error,
          });
          if (outcome.isRateLimit) stoppedByRateLimit = true;
        } else {
          results.push({ messageId: message.id, conversationId: destinationId, ok: true });
        }
      }
    }

    const sent = results.filter((r) => r.ok).length;
    return NextResponse.json({ sent, results });
  } catch (err) {
    console.error('Error in POST .../messages/forward:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

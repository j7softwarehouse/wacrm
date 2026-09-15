import { NextResponse } from 'next/server';

import { createClient } from '@/lib/supabase/server';
import {
  MEDIA_KINDS,
  SendMessageError,
  sendMessageToConversation,
} from '@/lib/whatsapp/send-message';
import { ProviderRateLimitError } from '@/lib/whatsapp/providers/types';
import { resolveDefaultChannelId } from '@/lib/whatsapp/providers/resolve';
import { resolveChannelPhone } from '@/lib/whatsapp/channel-identity';

// ============================================================
// POST /api/whatsapp/messages/[id]/forward — encaminha uma mensagem
// para outras conversas, igual ao WhatsApp. Body:
// { conversationIds: string[] }.
//
// Encaminhar é reenviar o CONTEÚDO como mensagem nova no destino —
// não é uma referência à original. É assim que o WhatsApp funciona:
// quem recebe fica com uma cópia própria, e apagar/editar a original
// depois não mexe no que já foi encaminhado.
//
// Limite de 5 destinos por encaminhamento, igual ao WhatsApp. Não é
// capricho de UI: disparar a mesma mensagem para dezenas de chats de
// uma vez é exatamente o padrão que faz o WhatsApp banir o número —
// e o número aqui é o da escola inteira. Quem precisa falar com muita
// gente tem Broadcasts/grupos, que são os caminhos próprios pra isso.
//
// Envio SEQUENCIAL, nunca em paralelo, e para de vez no primeiro
// erro de limite do provedor (mesma regra que broadcast-core já
// segue): insistir depois de um rate limit queima a reputação do
// número e escala para banimento.
// ============================================================

const MAX_DESTINATIONS = 5;

/** Tipos que fazem sentido encaminhar. Template e interativo ficam de
 *  fora: dependem de aprovação/estrutura própria do destino e não são
 *  "conteúdo solto" que se reenvia. */
const FORWARDABLE_TYPES = ['text', ...MEDIA_KINDS] as const;

interface ForwardResult {
  conversationId: string;
  ok: boolean;
  error?: string;
}

/** Documento não guarda o nome do arquivo em coluna própria (só a
 *  legenda vai para `content_text`), então o nome real vem do último
 *  segmento da URL de storage — é o mesmo nome com que o arquivo foi
 *  salvo no upload. */
function filenameFromUrl(url: string): string | undefined {
  try {
    const path = new URL(url).pathname;
    const last = path.split('/').pop();
    return last ? decodeURIComponent(last) : undefined;
  } catch {
    return undefined;
  }
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
    const conversationIds: string[] = Array.isArray(body?.conversationIds)
      ? body.conversationIds.filter((c: unknown) => typeof c === 'string')
      : [];
    // Mensagem opcional que acompanha o encaminhamento — igual ao
    // WhatsApp, que deixa escrever algo na própria tela de "Encaminhar
    // para". Vai como mensagem COMUM separada, nunca com forwarded:
    // true (não é uma cópia da original, é conteúdo novo do atendente).
    const note: string =
      typeof body?.note === 'string' ? body.note.trim() : '';

    if (conversationIds.length === 0) {
      return NextResponse.json(
        { error: 'At least one destination conversation is required' },
        { status: 400 },
      );
    }
    if (conversationIds.length > MAX_DESTINATIONS) {
      return NextResponse.json(
        { error: `At most ${MAX_DESTINATIONS} destinations are allowed` },
        { status: 400 },
      );
    }

    const { data: message, error: msgError } = await supabase
      .from('messages')
      .select('id, conversation_id, content_type, content_text, media_url, deleted_at')
      .eq('id', id)
      .maybeSingle();

    if (msgError || !message) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 });
    }

    // Tenancy da ORIGEM: sem isto, um id de mensagem de outra conta
    // viraria conteúdo encaminhável para dentro desta conta.
    const { data: sourceConversation } = await supabase
      .from('conversations')
      .select('id, channel_id')
      .eq('id', message.conversation_id)
      .eq('account_id', accountId)
      .maybeSingle();

    if (!sourceConversation) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 });
    }

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
    // `media_url` zerado (retenção de mídia). Não dá para encaminhar o
    // que não existe mais do nosso lado — a UI já desabilita o botão
    // nesse caso; aqui é a rede de proteção.
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

    // Tenancy do DESTINO + MESMO CANAL (mesmo NÚMERO) da origem: dois
    // canais só são "contas independentes" quando o telefone é
    // diferente — recriar a instância UAZAPI do mesmo número (ex.: após
    // "Invalid token") não pode virar um canal novo pra este efeito, e
    // uma conversa órfã (channel_id nulo, canal antigo já apagado) cai
    // no canal padrão da conta em vez de ficar travada pra sempre — ver
    // channel-identity.ts.
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

    // Uma consulta só resolve os candidatos da CONTA; o filtro por
    // telefone acontece em cima disso, porque comparar telefone exige
    // resolver canal-a-canal (Postgrest não faz esse COALESCE sozinho).
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

    const filename =
      contentType === 'document' && message.media_url
        ? filenameFromUrl(message.media_url as string)
        : undefined;

    // A nota vira LEGENDA da própria mensagem encaminhada sempre que o
    // tipo aceita legenda — um balão só, pedido do usuário depois de
    // ver dois balões separados na prática ("gera confusão"). Áudio é
    // a única exceção real: o WhatsApp recusa legenda em áudio (mesma
    // regra de `message-composer.tsx`), então a nota tem que sair como
    // mensagem de texto à parte nesse caso específico.
    const noteMustBeSeparateMessage = note && contentType === 'audio';
    const combinedContentText =
      note && !noteMustBeSeparateMessage
        ? message.content_text
          ? `${message.content_text}\n\n${note}`
          : note
        : ((message.content_text as string | null) ?? null);

    const results: ForwardResult[] = [];
    let stoppedByRateLimit = false;

    for (const destinationId of conversationIds) {
      if (stoppedByRateLimit) {
        results.push({
          conversationId: destinationId,
          ok: false,
          error: 'Skipped: WhatsApp rate limit reached.',
        });
        continue;
      }
      try {
        await sendMessageToConversation(supabase, accountId, {
          conversationId: destinationId,
          messageType: contentType,
          contentText: combinedContentText,
          mediaUrl: (message.media_url as string | null) ?? null,
          filename: filename ?? null,
          senderUserId: user.id,
          forwarded: true,
        });
        // Só chega aqui quando a nota NÃO pôde ir junto (áudio). Tenta
        // DEPOIS do encaminhamento ter saído — se ela falhar, o destino
        // inteiro conta como falho: pro atendente, "encaminhar com uma
        // mensagem" é uma entrega só.
        if (noteMustBeSeparateMessage) {
          await sendMessageToConversation(supabase, accountId, {
            conversationId: destinationId,
            messageType: 'text',
            contentText: note,
            senderUserId: user.id,
          });
        }
        results.push({ conversationId: destinationId, ok: true });
      } catch (err) {
        if (err instanceof ProviderRateLimitError) {
          // Para tudo: insistir depois de um limite do provedor é o que
          // leva o número ao banimento.
          stoppedByRateLimit = true;
          results.push({
            conversationId: destinationId,
            ok: false,
            error: err.message,
          });
          continue;
        }
        const reason =
          err instanceof SendMessageError || err instanceof Error
            ? err.message
            : 'Unknown error';
        results.push({ conversationId: destinationId, ok: false, error: reason });
      }
    }

    const sent = results.filter((r) => r.ok).length;
    return NextResponse.json({ sent, results });
  } catch (err) {
    console.error('Error in POST .../messages/[id]/forward:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

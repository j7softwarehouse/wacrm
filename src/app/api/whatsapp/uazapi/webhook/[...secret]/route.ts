import { NextResponse, after } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { ingestInboundMessage } from "@/lib/whatsapp/inbound/ingest";
import {
  mapInstanceStatus,
  mapUazapiMessageStatus,
  type CrmMessageStatus,
} from "@/lib/whatsapp/uazapi/connection";
import { extractEventType, normalizeUazapiEvent } from "@/lib/whatsapp/uazapi/normalize";
import { getProviderForChannel } from "@/lib/whatsapp/providers/resolve";
import type { WhatsAppChannel } from "@/types";

export const maxDuration = 60;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminClient: any = null;
function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
  }
  return _adminClient;
}

/**
 * Entrada de eventos da UAZAPI.
 *
 * O segredo vive no caminho da URL porque o objeto `Webhook` da UAZAPI
 * só tem o campo `url` — não há onde declarar header customizado nem
 * segredo compartilhado, diferente da Meta que assina o corpo com
 * HMAC. Um único lookup por `webhook_secret` identifica QUAL dos N
 * canais falou e prova que quem chamou conhece o segredo.
 *
 * A rota é catch-all (`[...secret]`) por precaução: se alguém ativar
 * `addUrlEvents` no painel da UAZAPI, chegam segmentos extras à
 * direita, e é melhor ignorá-los do que devolver 404 silencioso.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ secret: string[] }> },
) {
  const { secret } = await params;
  const token = secret?.[0];

  if (!token) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const { data: channel } = await supabaseAdmin()
    .from("whatsapp_channels")
    .select("*")
    .eq("webhook_secret", token)
    .maybeSingle();

  if (!channel) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => null);

  // Responde 200 imediatamente e processa depois: a UAZAPI reentrega
  // em caso de timeout, e reentrega significa histórico duplicado.
  after(async () => {
    try {
      await handleEvent(channel as WhatsAppChannel, body);
    } catch (err) {
      console.error(
        "[uazapi/webhook] falha ao processar evento:",
        err instanceof Error ? err.message : err,
      );
    }
  });

  return NextResponse.json({ ok: true });
}

/**
 * Avança o status de UMA mensagem — e só se ela pertencer a este canal.
 *
 * O escopo é obrigatório: o `webhook_secret` é uma credencial que TODO
 * tenant possui para o próprio canal (a UI de canais mostra a URL
 * completa), diferente do HMAC server-side da Meta. Sem o filtro, um
 * tenant poderia forjar um `messages_update` com o
 * `provider_message_id` de outra conta e mexer no histórico alheio —
 * `messages.message_id` não é único por conta e o UPDATE original
 * casava por ele e mais nada.
 *
 * Duas etapas em vez de um embed (`conversations!inner(...)`): o embed
 * depende do schema cache do PostgREST, que fica obsoleto logo após
 * migrações e derruba a query inteira com PGRST200.
 */
async function applyMessageStatus(
  channel: WhatsAppChannel,
  messageId: string,
  status: CrmMessageStatus,
): Promise<void> {
  const db = supabaseAdmin();

  const { data: messages, error: findError } = await db
    .from("messages")
    .select("id, conversation_id")
    .eq("message_id", messageId);

  if (findError) {
    console.error(
      "[uazapi/webhook] falha ao localizar mensagem:",
      findError.message,
    );
    return;
  }
  if (!messages || messages.length === 0) return;

  const conversationIds = [
    ...new Set(
      messages
        .map((m: { conversation_id: string | null }) => m.conversation_id)
        .filter((id: string | null): id is string => Boolean(id)),
    ),
  ];
  if (conversationIds.length === 0) return;

  const { data: owned, error: convError } = await db
    .from("conversations")
    .select("id")
    .in("id", conversationIds)
    .eq("account_id", channel.account_id)
    .eq("channel_id", channel.id);

  if (convError) {
    console.error(
      "[uazapi/webhook] falha ao validar a conversa:",
      convError.message,
    );
    return;
  }

  const ownedIds = new Set((owned ?? []).map((c: { id: string }) => c.id));
  const targetIds = messages
    .filter((m: { conversation_id: string | null }) =>
      m.conversation_id ? ownedIds.has(m.conversation_id) : false,
    )
    .map((m: { id: string }) => m.id);

  if (targetIds.length === 0) return;

  const { error: updateError } = await db
    .from("messages")
    .update({ status })
    .in("id", targetIds);

  if (updateError) {
    console.error(
      "[uazapi/webhook] falha ao atualizar status da mensagem:",
      updateError.message,
    );
  }
}

async function handleEvent(channel: WhatsAppChannel, body: unknown) {
  if (!body || typeof body !== "object") return;
  const envelope = body as Record<string, unknown>;
  const eventName = extractEventType(envelope);

  // Nem "connection" nem "messages_update" foram capturados ao vivo
  // ainda (só "messages" — ver normalize.ts). Tolera tanto `data`
  // quanto `message` como o campo que carrega o corpo do evento, já
  // que o evento real de "messages" usa `message`, não `data`, e não
  // há motivo pra assumir que os outros dois sigam o vocabulário
  // antigo só porque a doc dizia isso.
  const payload =
    (envelope.data && typeof envelope.data === "object"
      ? (envelope.data as Record<string, unknown>)
      : null) ??
    (envelope.message && typeof envelope.message === "object"
      ? (envelope.message as Record<string, unknown>)
      : null) ??
    {};

  if (eventName === "connection") {
    const raw = typeof payload.status === "string" ? payload.status : undefined;
    await supabaseAdmin()
      .from("whatsapp_channels")
      .update({ status: mapInstanceStatus(raw) })
      .eq("id", channel.id);
    return;
  }

  if (eventName === "messages_update" || eventName === "status") {
    const messageId = typeof payload.messageid === "string" ? payload.messageid : null;
    const status = mapUazapiMessageStatus(
      typeof payload.status === "string" ? payload.status : null,
    );
    if (messageId && status) {
      await applyMessageStatus(channel, messageId, status);
    }
    return;
  }

  const normalized = normalizeUazapiEvent(body);
  if (!normalized) return;

  // Mídia recebida é baixada para o Storage — as URLs do WhatsApp
  // expiram e deixariam o histórico quebrado.
  //
  // getProviderForChannel/buildProvider recusa canais cujo status
  // espelhado no banco não seja "connected" (guarda pensada para
  // envios). Esse status é atualizado por um evento "connection"
  // separado, sem garantia de ordem em relação a "messages" — então
  // uma mensagem pode chegar durante uma oscilação breve de status.
  // Como a resposta 200 já foi enviada antes do after() rodar, a
  // UAZAPI não reentrega: deixar o erro subir aqui derrubaria a
  // mensagem inteira (texto incluído), não só a mídia. Por isso o
  // erro é contido localmente e a mídia degrada para undefined.
  let content = normalized.content;
  if (content.mediaUrl) {
    try {
      const provider = await getProviderForChannel(supabaseAdmin(), channel.id);
      const stored = await provider.resolveInboundMediaUrl(content.mediaUrl);
      content = { ...content, mediaUrl: stored ?? undefined };
    } catch (err) {
      console.error(
        "[uazapi/webhook] falha ao resolver mídia recebida:",
        err instanceof Error ? err.message : err,
      );
      content = { ...content, mediaUrl: undefined };
    }
  }

  await ingestInboundMessage(supabaseAdmin(), {
    channel,
    from: normalized.from,
    pushName: normalized.pushName,
    providerMessageId: normalized.providerMessageId,
    timestamp: normalized.timestamp,
    content,
    replyToProviderMessageId: normalized.replyToProviderMessageId,
  });
}

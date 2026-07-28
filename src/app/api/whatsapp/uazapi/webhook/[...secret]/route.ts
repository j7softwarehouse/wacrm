import { NextResponse, after } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { ingestInboundMessage } from "@/lib/whatsapp/inbound/ingest";
import { mapInstanceStatus } from "@/lib/whatsapp/uazapi/connection";
import { normalizeUazapiEvent } from "@/lib/whatsapp/uazapi/normalize";
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

async function handleEvent(channel: WhatsAppChannel, body: unknown) {
  const eventName = (body as { event?: string } | null)?.event;

  if (eventName === "connection") {
    const raw = (body as { data?: { status?: string } }).data?.status;
    await supabaseAdmin()
      .from("whatsapp_channels")
      .update({ status: mapInstanceStatus(raw) })
      .eq("id", channel.id);
    return;
  }

  if (eventName === "messages_update" || eventName === "status") {
    const d = (body as { data?: Record<string, unknown> }).data ?? {};
    const messageId = typeof d.messageid === "string" ? d.messageid : null;
    const status = typeof d.status === "string" ? d.status : null;
    if (messageId && status) {
      await supabaseAdmin()
        .from("messages")
        .update({ status })
        .eq("message_id", messageId);
    }
    return;
  }

  const normalized = normalizeUazapiEvent(body);
  if (!normalized) return;

  // Mídia recebida é baixada para o Storage — as URLs do WhatsApp
  // expiram e deixariam o histórico quebrado.
  let content = normalized.content;
  if (content.mediaUrl) {
    const provider = await getProviderForChannel(supabaseAdmin(), channel.id);
    const stored = await provider.resolveInboundMediaUrl(content.mediaUrl);
    content = { ...content, mediaUrl: stored ?? undefined };
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

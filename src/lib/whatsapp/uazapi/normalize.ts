// ============================================================
// WebhookEvent da UAZAPI → InboundContent do CRM.
//
// Defensivo por necessidade: `WebhookEvent.data` é
// `additionalProperties: true` no schema, e a documentação diverge
// entre a página do SSE e o schema `Message`. Todo campo é tratado
// como opcional e há fallback entre os dois vocabulários.
//
// Nunca lança: devolve null para qualquer coisa que não seja uma
// mensagem aproveitável. Webhook que responde 500 é reentregue em
// loop pelo provedor.
// ============================================================

import type { InboundContent } from "@/lib/whatsapp/inbound/ingest";

export interface NormalizedInbound {
  from: string;
  pushName?: string;
  providerMessageId: string;
  timestamp: number;
  content: InboundContent;
  replyToProviderMessageId?: string;
}

/** `5511999999999@s.whatsapp.net` → `5511999999999`. */
function phoneFromJid(jid: unknown): string | null {
  if (typeof jid !== "string" || !jid) return null;
  const [user] = jid.split("@");
  if (!user) return null;
  const [phone] = user.split(":");
  return phone || null;
}

/**
 * `imageMessage`, `image`, `videoMessage`… → o tipo do CRM.
 * Qualquer coisa não reconhecida com fileURL cai em `document`.
 */
function mapContentType(
  messageType: unknown,
  hasFile: boolean,
): InboundContent["type"] {
  const t = typeof messageType === "string" ? messageType.toLowerCase() : "";
  if (t.includes("image")) return "image";
  if (t.includes("video")) return "video";
  if (t.includes("audio") || t.includes("ptt")) return "audio";
  if (t.includes("sticker")) return "sticker";
  if (t.includes("location")) return "location";
  if (t.includes("document")) return "document";
  return hasFile ? "document" : "text";
}

export function normalizeUazapiEvent(event: unknown): NormalizedInbound | null {
  if (!event || typeof event !== "object") return null;

  const e = event as { event?: unknown; data?: unknown };

  // O envelope usa "message" no SINGULAR, enquanto a assinatura usa
  // "messages" no plural. Aceitar os dois evita depender de qual
  // vocabulário o servidor emprega neste evento.
  if (e.event !== "message" && e.event !== "messages") return null;
  if (!e.data || typeof e.data !== "object") return null;

  const d = e.data as Record<string, unknown>;

  if (d.isGroup === true) return null;
  if (d.wasSentByApi === true) return null;
  if (d.fromMe === true) return null;

  const from = phoneFromJid(d.sender) ?? phoneFromJid(d.from) ?? phoneFromJid(d.chatid);
  if (!from) return null;

  const providerMessageId =
    (typeof d.messageid === "string" && d.messageid) ||
    (typeof d.id === "string" && d.id) ||
    "";
  if (!providerMessageId) return null;

  const rawTimestamp = d.messageTimestamp ?? d.timestamp;
  const timestamp =
    typeof rawTimestamp === "number" && Number.isFinite(rawTimestamp)
      ? rawTimestamp
      : Math.floor(Date.now() / 1000);

  const fileURL = typeof d.fileURL === "string" && d.fileURL ? d.fileURL : undefined;
  const text = typeof d.text === "string" && d.text ? d.text : undefined;

  const content: InboundContent = {
    type: mapContentType(d.messageType, Boolean(fileURL)),
    text,
    mediaUrl: fileURL,
  };

  // `buttonOrListid` carrega o título do botão/linha tocado — é o que
  // o motor de Flows usa para avançar a execução.
  if (typeof d.buttonOrListid === "string" && d.buttonOrListid) {
    content.interactiveReplyId = d.buttonOrListid;
  }

  return {
    from,
    pushName: typeof d.senderName === "string" ? d.senderName : undefined,
    providerMessageId,
    timestamp,
    content,
    replyToProviderMessageId:
      typeof d.quoted === "string" && d.quoted ? d.quoted : undefined,
  };
}

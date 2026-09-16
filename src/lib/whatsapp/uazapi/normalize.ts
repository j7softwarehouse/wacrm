// ============================================================
// WebhookEvent da UAZAPI → InboundContent do CRM.
//
// O envelope real (capturado de uma entrega de produção, 2026-07-29 —
// a doc nunca bateu com isso) é:
//   { EventType: "messages", chat: {...}, message: {...}, ... }
// — não `{ event: "message"|"messages", data: {...} }` como a Parte B
// original assumiu a partir só da doc (que a própria doc já avisava
// ser inconsistente). Mantemos o formato antigo como fallback barato
// — não custa nada e cobre a hipótese de outro modo de entrega usar o
// vocabulário antigo — mas o real é o que rege.
//
// Defensivo por necessidade: campo é tratado como opcional em todo
// lugar. Nunca lança: devolve null para qualquer coisa que não seja
// uma mensagem aproveitável. Webhook que responde 500 é reentregue em
// loop pelo provedor.
// ============================================================

import type { InboundContent } from "@/lib/whatsapp/inbound/ingest";
import type { WhatsAppMediaType } from "./media-crypto";

/**
 * Tudo que a descriptografia de mídia (`media-crypto.ts`) precisa,
 * empacotado como JSON dentro de `InboundContent.mediaUrl`. O CDN do
 * WhatsApp (`content.URL`) serve o arquivo CIFRADO — sem `mediaKey` os
 * bytes baixados não abrem como imagem/vídeo/áudio nenhum.
 */
export interface EncryptedMediaReference {
  url: string;
  mediaKey: string;
  mediaType: WhatsAppMediaType;
  mimetype: string;
}

const FILE_BEARING_TYPES: readonly string[] = [
  "image",
  "video",
  "audio",
  "document",
  "sticker",
];

function isFileBearingType(t: InboundContent["type"]): t is WhatsAppMediaType {
  return FILE_BEARING_TYPES.includes(t);
}

export interface NormalizedInbound {
  from: string;
  pushName?: string;
  providerMessageId: string;
  timestamp: number;
  content: InboundContent;
  replyToProviderMessageId?: string;
  /** Presente só em mensagem de grupo. Ausente = 1:1. */
  group?: {
    groupJid: string;
    participantJid: string;
    participantName?: string;
  };
}

/** `5511999999999@s.whatsapp.net` → `5511999999999`. */
function phoneFromJid(jid: unknown): string | null {
  if (typeof jid !== "string" || !jid) return null;
  const [user] = jid.split("@");
  if (!user) return null;
  const [phone] = user.split(":");
  return phone || null;
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v ? v : undefined;
}

/** Nome do evento, nos dois vocabulários possíveis — `EventType` é o confirmado. */
export function extractEventType(event: Record<string, unknown>): string | undefined {
  if (typeof event.EventType === "string") return event.EventType;
  if (typeof event.event === "string") return event.event;
  return undefined;
}

/** Onde os campos da mensagem moram, nos dois vocabulários possíveis. */
function extractMessageData(
  event: Record<string, unknown>,
): Record<string, unknown> | null {
  if (event.message && typeof event.message === "object") {
    return event.message as Record<string, unknown>;
  }
  if (event.data && typeof event.data === "object") {
    return event.data as Record<string, unknown>;
  }
  return null;
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

  const e = event as Record<string, unknown>;

  // "message" no singular vs "messages" no plural: aceitar os dois
  // evita depender de qual vocabulário o servidor emprega neste evento.
  const eventType = extractEventType(e);
  if (eventType !== "message" && eventType !== "messages") return null;

  const d = extractMessageData(e);
  if (!d) return null;

  if (d.wasSentByApi === true) return null;
  if (d.fromMe === true) return null;

  const isGroup = d.isGroup === true;

  // `sender_pn` é o JID baseado em TELEFONE do remetente — confirmado
  // com evento real. `sender` sozinho pode vir no formato @lid (o
  // identificador opaco e não-telefônico que o WhatsApp usa cada vez
  // mais por privacidade), que não é um número utilizável. Por isso
  // `sender_pn` vem ANTES de `sender` — na ordem errada, toda mensagem
  // vira um "contato" com o número de LID em vez do telefone real.
  //
  // `chatid` só entra na cadeia em mensagem 1:1, onde é o JID da
  // própria conversa (equivalente ao remetente). Em GRUPO, `chatid` é
  // o JID DO GRUPO — usá-lo aqui gravaria o grupo como se fosse quem
  // enviou a mensagem.
  const from =
    phoneFromJid(d.sender_pn) ??
    (isGroup ? null : phoneFromJid(d.chatid)) ??
    phoneFromJid(d.sender) ??
    phoneFromJid(d.from);
  if (!from) return null;

  // Em grupo, `chatid` é o JID DO GRUPO — não serve como identidade do
  // remetente. O participante tem que sair de `sender_pn`/`sender`, e
  // quando só houver @lid ficamos sem telefone (por isso
  // `group_participants.phone` é nulável).
  const groupJid = isGroup ? asString(d.chatid) : undefined;
  const participantJid = isGroup
    ? (asString(d.sender_pn) ?? asString(d.sender))
    : undefined;

  const group =
    groupJid && participantJid
      ? {
          groupJid,
          participantJid,
          participantName: asString(d.senderName) ?? asString(d.pushName),
        }
      : undefined;

  // Grupo sem participante identificável é descartado: sem autor a
  // mensagem viraria um balão anônimo na thread.
  if (isGroup && !group) return null;

  const providerMessageId =
    (typeof d.messageid === "string" && d.messageid) ||
    (typeof d.id === "string" && d.id) ||
    "";
  if (!providerMessageId) return null;

  // Confirmado com evento real: `messageTimestamp` vem em
  // MILISSEGUNDOS, não segundos — um valor tratado como segundos
  // aterrissaria décadas no futuro. Qualquer valor maior que ~ano-2286
  // em segundos (1e12) só pode ser milissegundos.
  const rawTimestamp = d.messageTimestamp ?? d.timestamp;
  const timestamp =
    typeof rawTimestamp === "number" && Number.isFinite(rawTimestamp)
      ? rawTimestamp > 1e12
        ? Math.floor(rawTimestamp / 1000)
        : rawTimestamp
      : Math.floor(Date.now() / 1000);

  // Confirmado com evento real de imagem capturado em 2026-07-30: para
  // mensagens de mídia, `d.content` é um OBJETO com `URL`/`mediaKey`/
  // `mimetype` — não a string plana que carrega texto em mensagens de
  // texto (`d.content` também é usado como fallback de `text` abaixo).
  // `fileURL` no topo do evento nunca existiu; era um campo assumido a
  // partir da doc, nunca confirmado ao vivo.
  const mediaContent =
    d.content && typeof d.content === "object"
      ? (d.content as Record<string, unknown>)
      : null;
  const mediaUrlRaw =
    mediaContent && typeof mediaContent.URL === "string" && mediaContent.URL
      ? mediaContent.URL
      : undefined;
  const mediaKey =
    mediaContent && typeof mediaContent.mediaKey === "string" && mediaContent.mediaKey
      ? mediaContent.mediaKey
      : undefined;
  const mimetype =
    mediaContent && typeof mediaContent.mimetype === "string"
      ? mediaContent.mimetype
      : "application/octet-stream";

  // `text` e `content` vieram idênticos no evento real de TEXTO
  // capturado; aceitar os dois é barato e não custa nada de precisão.
  // Quando `content` é objeto (mensagem de mídia), o guard de tipo já
  // descarta essa alternativa aqui.
  const text =
    (typeof d.text === "string" && d.text) ||
    (typeof d.content === "string" && d.content) ||
    undefined;

  const contentType = mapContentType(d.messageType, Boolean(mediaUrlRaw));

  // O WhatsApp criptografa toda mídia ponta-a-ponta: sem `mediaKey` os
  // bytes do CDN são inúteis, então só empacota a referência quando as
  // duas partes existem — ver media-crypto.ts para o porquê.
  const mediaUrl: string | undefined =
    mediaUrlRaw && mediaKey && isFileBearingType(contentType)
      ? JSON.stringify({
          url: mediaUrlRaw,
          mediaKey,
          mediaType: contentType,
          mimetype,
        } satisfies EncryptedMediaReference)
      : undefined;

  const content: InboundContent = {
    type: contentType,
    text,
    mediaUrl,
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
    group,
  };
}

// ============================================================
// Resumo de um evento recebido da UAZAPI para o log de auditoria
// (tabela `webhook_events`).
//
// Guarda só metadados: tipo do evento, IDs, horário e tipo de mídia.
// NÃO guarda texto de mensagem, nome, telefone nem o corpo bruto —
// o log existe para diagnosticar entrega e recuperação, não para
// duplicar conversas. Por isso é uma allowlist explícita.
// ============================================================

export interface WebhookEventLogRow {
  event_type: string | null;
  message_id: string | null;
  chat_id: string | null;
  message_type: string | null;
  message_timestamp: string | null;
  from_me: boolean | null;
  is_group: boolean | null;
}

type Dict = Record<string, unknown>;

function asDict(value: unknown): Dict | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Dict)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

/** Timestamp da UAZAPI pode vir em segundos ou em milissegundos. */
function toIsoTimestamp(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  const ms = value > 1e12 ? value : value * 1000;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Extrai do corpo do webhook só os campos que ajudam a diagnosticar
 * uma mensagem. Tolerante a formatos diferentes: qualquer campo
 * ausente vira `null`, nunca lança exceção.
 */
export function summarizeWebhookEvent(body: unknown): WebhookEventLogRow {
  const root = asDict(body) ?? {};
  const message = asDict(root.message) ?? {};
  const chat = asDict(root.chat) ?? {};

  return {
    event_type:
      asString(root.EventType) ?? asString(root.event) ?? asString(root.type),
    message_id:
      asString(message.messageid) ??
      asString(message.id) ??
      asString(root.messageid),
    chat_id:
      asString(message.chatid) ??
      asString(chat.wa_chatid) ??
      asString(root.chatid),
    message_type:
      asString(message.messageType) ?? asString(message.mediaType),
    message_timestamp: toIsoTimestamp(
      message.messageTimestamp ?? root.messageTimestamp,
    ),
    from_me: asBoolean(message.fromMe),
    is_group: asBoolean(message.isGroup),
  };
}

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
  /** Só os NOMES das chaves do payload (ex.: "updates.0.key.id"), sem valores. */
  payload_keys: string | null;
}

const MAX_KEYS = 60;
const MAX_DEPTH = 4;

/** Lista caminhos de chaves do payload, sem nenhum valor. Serve para
 *  descobrir o formato real de eventos que ainda não conhecemos. */
export function describePayloadKeys(body: unknown): string | null {
  const out: string[] = [];
  const walk = (value: unknown, path: string, depth: number) => {
    if (out.length >= MAX_KEYS || depth > MAX_DEPTH) return;
    if (Array.isArray(value)) {
      if (value.length > 0) walk(value[0], `${path}.0`, depth + 1);
      return;
    }
    const dict = asDict(value);
    if (!dict) return;
    for (const key of Object.keys(dict)) {
      if (out.length >= MAX_KEYS) return;
      const next = path ? `${path}.${key}` : key;
      out.push(next);
      walk(dict[key], next, depth + 1);
    }
  };
  walk(body, "", 0);
  return out.length > 0 ? out.join(",") : null;
}

/** Primeira string não vazia entre os caminhos informados. */
function firstString(root: Dict, paths: string[][]): string | null {
  for (const path of paths) {
    let cur: unknown = root;
    for (const key of path) {
      if (Array.isArray(cur)) {
        const index = Number(key);
        cur = Number.isInteger(index) ? cur[index] : undefined;
        continue;
      }
      const dict = asDict(cur);
      if (!dict) {
        cur = undefined;
        break;
      }
      cur = dict[key];
    }
    const found = asString(cur);
    if (found) return found;
  }
  return null;
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
      firstString(root, [
        ["messageid"],
        ["event", "messageid"],
        ["data", "key", "id"],
        ["updates", "0", "key", "id"],
        ["event", "MessageIDs", "0"],
      ]),
    payload_keys: describePayloadKeys(body),
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

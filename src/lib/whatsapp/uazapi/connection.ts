// ============================================================
// Helpers do ciclo de conexão da UAZAPI.
// ============================================================

export type ChannelStatus =
  | "connected"
  | "connecting"
  | "disconnected"
  | "hibernated";

const KNOWN_STATUSES: ChannelStatus[] = [
  "connected",
  "connecting",
  "disconnected",
  "hibernated",
];

/**
 * Falha fechado: status desconhecido vira `disconnected`. Um estado
 * que não entendemos não pode ser tratado como conectado, ou o CRM
 * tentaria enviar por um canal morto.
 */
export function mapInstanceStatus(raw: string | undefined): ChannelStatus {
  if (raw && (KNOWN_STATUSES as string[]).includes(raw)) {
    return raw as ChannelStatus;
  }
  return "disconnected";
}

/** `5511999999999:12@s.whatsapp.net` → `5511999999999`. */
export function phoneFromJid(jid: string | null | undefined): string | null {
  if (!jid) return null;
  const [user] = jid.split("@");
  if (!user) return null;
  const [phone] = user.split(":");
  return phone || null;
}

export interface UazapiWebhookConfig {
  url: string;
  events: string[];
  excludeMessages: string[];
  addUrlEvents: boolean;
  addUrlTypesMessages: boolean;
}

export function buildWebhookConfig(url: string): UazapiWebhookConfig {
  return {
    url,
    // Nomes no PLURAL — a assinatura usa vocabulário diferente do
    // envelope do evento, que chega no singular ("message").
    events: ["messages", "messages_update", "connection"],
    excludeMessages: ["wasSentByApi", "isGroupYes"],
    addUrlEvents: false,
    addUrlTypesMessages: false,
  };
}

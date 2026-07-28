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

/** Vocabulário aceito por `messages.status` (CHECK da migração 001). */
export type CrmMessageStatus =
  | "sending"
  | "sent"
  | "delivered"
  | "read"
  | "failed";

/**
 * Status de mensagem da UAZAPI → vocabulário do CRM.
 *
 * Allowlist explícita, e não repasse direto: `messages.status` tem um
 * CHECK de cinco valores (migração 001) e a UAZAPI usa outro
 * vocabulário (`DELIVERY_ACK`, `PLAYED`, `SERVER_ACK`…). Gravar o valor
 * cru viola a constraint, e como o webhook nunca checava o erro do
 * UPDATE, isso falhava em silêncio: nenhum status jamais avançava.
 *
 * Devolve `null` para qualquer coisa não reconhecida — o chamador pula
 * a atualização em vez de arriscar a constraint.
 */
export function mapUazapiMessageStatus(
  raw: string | null | undefined,
): CrmMessageStatus | null {
  if (!raw) return null;
  switch (raw.trim().toUpperCase()) {
    case "PENDING":
    case "SENDING":
      return "sending";
    case "SENT":
    case "SERVER_ACK":
    case "SERVERACK":
      return "sent";
    case "DELIVERED":
    case "DELIVERY_ACK":
    case "DELIVERYACK":
      return "delivered";
    case "READ":
    case "PLAYED":
      // `PLAYED` (áudio ouvido) implica lido e não tem estado próprio
      // no CRM.
      return "read";
    case "FAILED":
    case "ERROR":
      return "failed";
    default:
      return null;
  }
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
  enabled: boolean;
  events: string[];
  excludeMessages: string[];
  addUrlEvents: boolean;
  addUrlTypesMessages: boolean;
}

export function buildWebhookConfig(url: string): UazapiWebhookConfig {
  return {
    url,
    // Sem isso a UAZAPI cria o webhook DESABILITADO por padrão — o
    // registro parece ter funcionado (POST /webhook responde OK,
    // GET /webhook devolve a config com a URL certa) mas nada é
    // entregue. Só descoberto testando contra uma instância real.
    enabled: true,
    // Nomes no PLURAL — a assinatura usa vocabulário diferente do
    // envelope do evento, que chega no singular ("message").
    events: ["messages", "messages_update", "connection"],
    excludeMessages: ["wasSentByApi", "isGroupYes"],
    addUrlEvents: false,
    addUrlTypesMessages: false,
  };
}

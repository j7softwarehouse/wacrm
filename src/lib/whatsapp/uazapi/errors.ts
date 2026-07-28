// ============================================================
// Tradução dos erros da UAZAPI para os tipos do CRM.
//
// A UAZAPI distingue erro dela de erro do WhatsApp através de
// `error_source: "whatsapp_server"`. Essa distinção importa: um erro
// dela pode ser repetido; um erro do WhatsApp (463) não pode.
// ============================================================

import {
  ProviderError,
  ProviderRateLimitError,
} from "@/lib/whatsapp/providers/types";

/** Códigos do WhatsApp que significam "pare de enviar". */
const WHATSAPP_THROTTLE_CODES = new Set([463]);

interface UazapiErrorBody {
  error?: string;
  error_source?: string;
  provider_code?: number;
  error_key?: string;
  message?: string;
  message_ptbr?: string;
  provider_message?: string;
  provider_message_ptbr?: string;
}

function asBody(body: unknown): UazapiErrorBody {
  if (body && typeof body === "object") return body as UazapiErrorBody;
  return {};
}

export function parseUazapiError(status: number, body: unknown): Error {
  const b = asBody(body);

  // pt-BR primeiro: a API já devolve localizado e este deployment roda
  // em pt, então não há tradução nossa para manter sincronizada.
  const providerMessage = b.provider_message_ptbr ?? b.provider_message;

  if (b.provider_code && WHATSAPP_THROTTLE_CODES.has(b.provider_code)) {
    return new ProviderRateLimitError("uazapi", {
      errorKey: b.error_key,
      providerCode: b.provider_code,
      providerMessage,
    });
  }

  const message =
    b.message_ptbr ??
    b.error ??
    b.message ??
    (typeof body === "string" && body ? body : `Erro HTTP ${status} da UAZAPI.`);

  return new ProviderError("uazapi", message);
}

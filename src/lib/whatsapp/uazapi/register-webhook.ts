// ============================================================
// Registro (idempotente) do webhook de entrada de um canal UAZAPI.
//
// Duas rotas independentes observam um canal ficar `connected`:
//
//   • /channels/[id]/connect — quando o /instance/connect responde
//     que a instância JÁ estava conectada (o operador conectou pelo
//     painel da UAZAPI antes de cadastrar no CRM);
//   • /channels/[id]/status  — no polling do QR Code.
//
// Antes, só a segunda registrava, e só quando via a transição de
// status. No caminho acima a transição já tinha sido gravada pela
// primeira, então o registro nunca acontecia: o canal enviava e não
// recebia nada, sem sinal algum na UI.
//
// A regra agora é "conectado e sem `webhook_registered_at`" —
// registra uma vez, venha de onde vier. Reenviar o mesmo /webhook é
// inofensivo: o endpoint da UAZAPI sobrescreve a configuração, não
// acumula.
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import type { UazapiClient } from "./client";
import { buildWebhookConfig } from "./connection";

/** Canal minimamente identificado — o que as duas rotas têm em mãos. */
export interface RegistrableChannel {
  id: string;
  webhook_secret?: string | null;
}

export function buildInboundWebhookUrl(
  baseUrl: string,
  webhookSecret: string,
): string {
  return `${baseUrl.replace(/\/+$/, "")}/api/whatsapp/uazapi/webhook/${webhookSecret}`;
}

/**
 * Registra o webhook na instância e carimba `webhook_registered_at`.
 *
 * Nunca lança: o canal está conectado e consegue ENVIAR mesmo que o
 * registro falhe — o que quebra é o recebimento. Grava `last_error`
 * para a UI oferecer a configuração manual e devolve `false`.
 */
export async function registerUazapiWebhook(
  db: SupabaseClient,
  client: UazapiClient,
  channel: RegistrableChannel,
  baseUrl: string,
): Promise<boolean> {
  if (!channel.webhook_secret) {
    console.error(
      "[uazapi] canal sem webhook_secret; registro impossível:",
      channel.id,
    );
    return false;
  }

  const webhookUrl = buildInboundWebhookUrl(baseUrl, channel.webhook_secret);

  try {
    await client.post("/webhook", buildWebhookConfig(webhookUrl));
  } catch (err) {
    console.error(
      "[uazapi] falha ao registrar webhook:",
      err instanceof Error ? err.message : err,
    );
    await db
      .from("whatsapp_channels")
      .update({
        last_error:
          "Conectado, mas o registro automático do webhook falhou. " +
          "Configure a URL manualmente no painel da UAZAPI.",
      })
      .eq("id", channel.id);
    return false;
  }

  // `last_error` é escrito exclusivamente por este caminho, então
  // limpá-lo aqui não apaga informação de outra origem — só remove o
  // aviso que acabou de deixar de valer.
  const { error } = await db
    .from("whatsapp_channels")
    .update({
      webhook_registered_at: new Date().toISOString(),
      last_error: null,
    })
    .eq("id", channel.id);

  if (error) {
    console.error(
      "[uazapi] webhook registrado mas o carimbo falhou:",
      error.message,
    );
  }

  return true;
}

import { NextResponse } from "next/server";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { decrypt } from "@/lib/whatsapp/encryption";
import { createUazapiClient } from "@/lib/whatsapp/uazapi/client";
import {
  buildWebhookConfig,
  mapInstanceStatus,
  phoneFromJid,
} from "@/lib/whatsapp/uazapi/connection";

interface StatusResponse {
  instance?: { qrcode?: string; status?: string; profileName?: string };
  status?: { connected?: boolean; loggedIn?: boolean; jid?: string | null };
}

/**
 * Proxy autenticado de GET /instance/status.
 *
 * Serve a duas coisas ao mesmo tempo: detectar a conexão e devolver o
 * QR renovado, que a UAZAPI rotaciona durante o processo.
 *
 * Quando a conexão se completa, registra o webhook — é o único momento
 * em que sabemos que a instância está pronta para receber eventos.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { supabase, accountId } = await getCurrentAccount();
    const { id } = await params;

    const { data: channel, error } = await supabase
      .from("whatsapp_channels")
      .select("*")
      .eq("id", id)
      .eq("account_id", accountId)
      .maybeSingle();

    if (error || !channel) {
      return NextResponse.json({ error: "Canal não encontrado." }, { status: 404 });
    }

    const client = createUazapiClient({
      baseUrl: channel.uazapi_base_url,
      token: decrypt(channel.uazapi_token),
    });
    const result = await client.get<StatusResponse>("/instance/status");

    const status = mapInstanceStatus(result.instance?.status);
    const justConnected = status === "connected" && channel.status !== "connected";

    if (justConnected) {
      const origin = new URL(request.url).origin;
      const webhookUrl = `${origin}/api/whatsapp/uazapi/webhook/${channel.webhook_secret}`;
      try {
        await client.post("/webhook", buildWebhookConfig(webhookUrl));
      } catch (err) {
        // Não derruba a conexão: o canal está conectado e pode enviar.
        // O que falha é o recebimento — a UI mostra o aviso e oferece
        // a URL para configuração manual.
        console.error(
          "[uazapi] falha ao registrar webhook:",
          err instanceof Error ? err.message : err,
        );
        await supabase
          .from("whatsapp_channels")
          .update({
            last_error:
              "Conectado, mas o registro automático do webhook falhou. " +
              "Configure a URL manualmente no painel da UAZAPI.",
          })
          .eq("id", id);
      }
    }

    await supabase
      .from("whatsapp_channels")
      .update({
        status,
        phone_e164: phoneFromJid(result.status?.jid) ?? channel.phone_e164,
        connected_at:
          justConnected ? new Date().toISOString() : channel.connected_at,
      })
      .eq("id", id);

    return NextResponse.json({
      status,
      qrcode: status === "connecting" ? (result.instance?.qrcode ?? null) : null,
      phone: phoneFromJid(result.status?.jid),
      profileName: result.instance?.profileName ?? null,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

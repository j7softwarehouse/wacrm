import { NextResponse } from "next/server";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { getBaseUrl } from "@/lib/http/base-url";
import { decrypt } from "@/lib/whatsapp/encryption";
import { createUazapiClient } from "@/lib/whatsapp/uazapi/client";
import { mapInstanceStatus, phoneFromJid } from "@/lib/whatsapp/uazapi/connection";
import { registerUazapiWebhook } from "@/lib/whatsapp/uazapi/register-webhook";

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
 * Sempre que vê a instância conectada e ainda sem `webhook_registered_at`,
 * registra o webhook de entrada — o mesmo faz a rota /connect, porque
 * qualquer uma das duas pode ser a primeira a observar a conexão.
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

    // Gatilho do registro: "conectado e nunca registrado" — NÃO "houve
    // transição agora". A rota /connect também grava `status`, então uma
    // instância que já chegou conectada nunca produz transição aqui e o
    // webhook jamais era registrado (migração 042). `registerUazapiWebhook`
    // carimba `webhook_registered_at`, o que torna isto idempotente.
    if (status === "connected" && !channel.webhook_registered_at) {
      await registerUazapiWebhook(supabase, client, channel, getBaseUrl(request));
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

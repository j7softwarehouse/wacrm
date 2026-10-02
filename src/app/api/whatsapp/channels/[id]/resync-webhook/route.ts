import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { getBaseUrl } from "@/lib/http/base-url";
import { decrypt } from "@/lib/whatsapp/encryption";
import { createUazapiClient } from "@/lib/whatsapp/uazapi/client";
import { registerUazapiWebhook } from "@/lib/whatsapp/uazapi/register-webhook";

// ============================================================
// POST /api/whatsapp/channels/[id]/resync-webhook
//
// Reenvia a config do webhook pra UAZAPI, IGNORANDO o guard de
// "já registrado uma vez" que /connect e /status respeitam
// (`!channel.webhook_registered_at`). Existe porque mudar a lista de
// eventos assinados (`buildWebhookConfig`) no código NUNCA se propaga
// sozinho pra canais já conectados — e isso já causou perda real de
// mensagem em produção antes (grupo sem webhook atualizado, ver
// registro de incidente). Reenviar o MESMO /webhook é inofensivo: a
// UAZAPI sobrescreve a configuração, não acumula (mesma garantia que
// já sustenta `registerUazapiWebhook`).
//
// Não mexe na sessão do WhatsApp em si — só reenvia a config de
// ENTREGA de eventos. Ao contrário de /connect (POST
// /instance/connect), que é pra PAREAR uma sessão nova e não deveria
// ser chamado numa instância já conectada.
// ============================================================

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { supabase, accountId } = await requireRole("admin");
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
    if (channel.provider !== "uazapi") {
      return NextResponse.json(
        { error: "Só canais UAZAPI têm webhook pra reenviar." },
        { status: 400 },
      );
    }

    const client = createUazapiClient({
      baseUrl: channel.uazapi_base_url,
      token: decrypt(channel.uazapi_token),
    });

    const ok = await registerUazapiWebhook(supabase, client, channel, getBaseUrl(request));
    if (!ok) {
      return NextResponse.json(
        { error: "Falha ao reenviar a configuração do webhook." },
        { status: 502 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

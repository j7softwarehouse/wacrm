import { NextResponse } from "next/server";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { decrypt } from "@/lib/whatsapp/encryption";
import { createUazapiClient } from "@/lib/whatsapp/uazapi/client";
import { mapInstanceStatus } from "@/lib/whatsapp/uazapi/connection";

interface ConnectResponse {
  instance?: { qrcode?: string; paircode?: string; status?: string };
}

/**
 * Inicia a conexão e devolve o QR Code.
 *
 * O QR **não** é gravado: é credencial de sessão do WhatsApp e vive
 * apenas nesta resposta. A UI o exibe e o renova via /status.
 */
export async function POST(
  _request: Request,
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
    if (channel.provider !== "uazapi") {
      return NextResponse.json(
        { error: "Conexão por QR Code só existe em canais UAZAPI." },
        { status: 400 },
      );
    }

    const client = createUazapiClient({
      baseUrl: channel.uazapi_base_url,
      token: decrypt(channel.uazapi_token),
    });

    // Sem o campo `phone`, a UAZAPI devolve QR Code em vez de código
    // de pareamento. É essa omissão que define o modo de conexão.
    const result = await client.post<ConnectResponse>("/instance/connect", {});

    await supabase
      .from("whatsapp_channels")
      .update({
        status: mapInstanceStatus(result.instance?.status) === "connected"
          ? "connected"
          : "connecting",
        last_error: null,
      })
      .eq("id", id);

    return NextResponse.json({ qrcode: result.instance?.qrcode ?? null });
  } catch (err) {
    return toErrorResponse(err);
  }
}

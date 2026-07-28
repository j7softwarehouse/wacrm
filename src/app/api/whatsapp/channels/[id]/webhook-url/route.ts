import { NextResponse } from "next/server";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";

/**
 * Devolve a URL do webhook de entrada para diagnóstico manual.
 *
 * `webhook_secret` nunca sai do servidor via `toPublicChannel` (é a
 * única autenticação do webhook — a UAZAPI não assina o corpo como a
 * Meta faz com HMAC). Esta rota é a única exceção deliberada: o
 * próprio admin da conta pode precisar colar a URL no painel da
 * UAZAPI quando o registro automático falha (`last_error`
 * preenchido). Só o dono do canal (mesma conta) consegue chamá-la.
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
      .select("id, provider, webhook_secret")
      .eq("id", id)
      .eq("account_id", accountId)
      .maybeSingle();

    if (error || !channel) {
      return NextResponse.json({ error: "Canal não encontrado." }, { status: 404 });
    }
    if (channel.provider !== "uazapi") {
      return NextResponse.json(
        { error: "Apenas canais UAZAPI têm URL de webhook por canal." },
        { status: 400 },
      );
    }

    const origin = new URL(request.url).origin;
    const webhookUrl = `${origin}/api/whatsapp/uazapi/webhook/${channel.webhook_secret}`;

    return NextResponse.json({ webhookUrl });
  } catch (err) {
    return toErrorResponse(err);
  }
}

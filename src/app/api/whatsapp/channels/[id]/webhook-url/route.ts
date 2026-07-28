import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { getBaseUrl } from "@/lib/http/base-url";
import { buildInboundWebhookUrl } from "@/lib/whatsapp/uazapi/register-webhook";

/**
 * Devolve a URL do webhook de entrada para diagnóstico manual.
 *
 * `webhook_secret` nunca sai do servidor via `toPublicChannel` (é a
 * única autenticação do webhook — a UAZAPI não assina o corpo como a
 * Meta faz com HMAC). Esta rota é a única exceção deliberada: o
 * próprio admin da conta pode precisar colar a URL no painel da
 * UAZAPI quando o registro automático falha (`last_error`
 * preenchido).
 *
 * Exige `admin`, não só pertencer à conta: a URL CARREGA o segredo, e
 * escrever canais já é privilégio de admin pela RLS da 037 — deixar um
 * membro comum ler a credencial de entrada seria uma brecha por baixo
 * dessa mesma política.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { supabase, accountId } = await requireRole("admin");
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

    if (!channel.webhook_secret) {
      return NextResponse.json(
        { error: "Este canal não tem segredo de webhook." },
        { status: 409 },
      );
    }

    const webhookUrl = buildInboundWebhookUrl(
      getBaseUrl(request),
      channel.webhook_secret,
    );

    return NextResponse.json({ webhookUrl });
  } catch (err) {
    return toErrorResponse(err);
  }
}

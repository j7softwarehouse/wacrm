import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { supabaseAdmin } from "@/lib/flows/admin-client";
import { decrypt } from "@/lib/whatsapp/encryption";
import { getProviderForChannel } from "@/lib/whatsapp/providers/resolve";
import { createUazapiClient } from "@/lib/whatsapp/uazapi/client";
import { recoverMessages } from "@/lib/whatsapp/uazapi/recovery";

// ============================================================
// POST /api/whatsapp/channels/[id]/recover-messages
//
// Grava de verdade as mensagens que se perderam na queda de produção
// de 2026-10-07 (ver .../recover-messages/preview pra prévia só-
// leitura, que deveria rodar ANTES desta rota). Reaproveita o mesmo
// caminho de ingestão do webhook ao vivo — ver recovery.ts — com
// `suppressEngines: true` embutido em toda mensagem: nada de
// automação, fluxo, IA ou webhook público pra texto de horas atrás.
//
// `chatid`/`isGroup` no corpo restringem a UM chat — pensado pra
// validar visualmente um lote pequeno antes de rodar pra conta
// inteira (omitir os dois = todos os chats da janela).
//
// Grava com `supabaseAdmin()`, não com o client autenticado do
// admin que chamou — mesmo client que o webhook ao vivo usa pra
// gravar (ingestInboundMessage nunca rodou sob RLS de usuário).
// ============================================================

export const maxDuration = 60;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { supabase, accountId } = await requireRole("admin");
    const { id } = await params;

    const body = await request.json().catch(() => ({}));
    const sinceIso = typeof body.sinceIso === "string" ? body.sinceIso : null;
    const untilIso = typeof body.untilIso === "string" ? body.untilIso : null;
    const sinceMs = sinceIso ? Date.parse(sinceIso) : NaN;
    const untilMs = untilIso ? Date.parse(untilIso) : NaN;
    const onlyChatid = typeof body.chatid === "string" ? body.chatid : undefined;
    const onlyIsGroup = body.isGroup === true;

    if (!sinceIso || !untilIso || Number.isNaN(sinceMs) || Number.isNaN(untilMs)) {
      return NextResponse.json(
        { error: "Informe sinceIso e untilIso (datas ISO válidas)." },
        { status: 400 },
      );
    }
    if (untilMs <= sinceMs) {
      return NextResponse.json(
        { error: "untilIso precisa ser depois de sinceIso." },
        { status: 400 },
      );
    }

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
        { error: "Recuperação de histórico só existe pra canais UAZAPI." },
        { status: 400 },
      );
    }

    const client = createUazapiClient({
      baseUrl: channel.uazapi_base_url,
      token: decrypt(channel.uazapi_token),
    });

    const admin = supabaseAdmin();
    const provider = await getProviderForChannel(admin, channel.id);

    const result = await recoverMessages(
      admin,
      client,
      provider,
      channel,
      { sinceMs, untilMs },
      { onlyChatid, onlyIsGroup },
    );

    return NextResponse.json({
      window: { sinceIso, untilIso },
      chatsScanned: result.chatsScanned,
      truncated: result.truncated,
      inserted: result.inserted,
      alreadyExisted: result.alreadyExisted,
      skippedUnparseable: result.skippedUnparseable,
      errors: result.errors,
      outcomes: result.outcomes,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

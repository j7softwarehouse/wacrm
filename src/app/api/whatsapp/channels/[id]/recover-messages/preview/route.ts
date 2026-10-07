import { NextResponse } from "next/server";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { decrypt } from "@/lib/whatsapp/encryption";
import { createUazapiClient } from "@/lib/whatsapp/uazapi/client";
import { previewRecovery } from "@/lib/whatsapp/uazapi/recovery-preview";

// ============================================================
// POST /api/whatsapp/channels/[id]/recover-messages/preview
//
// Prévia SOMENTE LEITURA de mensagens que podem ter se perdido durante
// a queda de produção de 2026-10-07 (Vercel bloqueou o projeto, o
// webhook não teve pra onde entregar eventos). Consulta o histórico
// próprio da UAZAPI pra ver quantas mensagens existem numa janela de
// tempo, sem gravar nada — a ingestão de verdade é uma etapa separada,
// disparada manualmente depois de alguém revisar este resultado.
//
// `newCount` é quantas dessas mensagens AINDA não estão em `messages`
// — é o número que importa pra decidir se vale rodar a recuperação.
// ============================================================

// Uma conta com centenas de conversas ativas no dia faz dezenas de
// chamadas pra UAZAPI (paralelas, mas ainda assim demoradas) — o
// padrão de 10s/15s do runtime estoura fácil. Mesmo teto já usado
// pelo webhook e por outras rotas que chamam a UAZAPI.
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

    const result = await previewRecovery(client, { sinceMs, untilMs });

    // Marca quais ids já estão gravados — pra não contar como "nova"
    // mensagem algo que o webhook já ingeriu normalmente antes/depois
    // da queda.
    const allIds = result.byChat.flatMap((c) => c.messageIds);
    const existing = new Set<string>();
    if (allIds.length > 0) {
      const { data: rows } = await supabase
        .from("messages")
        .select("message_id")
        .in("message_id", allIds);
      for (const row of rows ?? []) existing.add(row.message_id as string);
    }

    return NextResponse.json({
      window: { sinceIso, untilIso },
      chatsScanned: result.chatsScanned,
      chatsWithMessages: result.chatsWithMessages,
      totalMessages: result.totalMessages,
      truncated: result.truncated,
      byChat: result.byChat.map((c) => ({
        chatid: c.chatid,
        isGroup: c.isGroup,
        count: c.count,
        newCount: c.messageIds.filter((id) => !existing.has(id)).length,
      })),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

import { NextResponse } from "next/server";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { supabaseAdmin } from "@/lib/flows/admin-client";
import type { InteractivePollPayload } from "@/lib/whatsapp/interactive";
import { applyPollVote } from "@/lib/whatsapp/poll-votes";
import { getProviderForChannel, resolveDefaultChannelId } from "@/lib/whatsapp/providers/resolve";

// ============================================================
// POST /api/whatsapp/messages/[id]/poll-vote
//
// Vota numa enquete enviada/recebida na conversa, com o número conectado
// da conta (uma escolha por requisição). Regra: a conta vota uma vez por
// enquete, como no WhatsApp — uma segunda tentativa devolve 409.
//
// A contagem é gravada pelo próprio CRM logo após o envio dar certo,
// porque o webhook não devolve votos enviados pela API.
// ============================================================

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { supabase, accountId } = await getCurrentAccount();
    const { id } = await params;

    const body = (await request.json().catch(() => null)) as { optionIndex?: unknown } | null;
    const optionIndex = body?.optionIndex;
    if (!Number.isInteger(optionIndex)) {
      return NextResponse.json({ error: "Informe a opção escolhida." }, { status: 400 });
    }

    // Leitura pelo cliente do usuário: a RLS garante que só quem enxerga a
    // conversa consegue votar nela.
    const { data: message } = await supabase
      .from("messages")
      .select("id, message_id, interactive_payload, conversation_id")
      .eq("id", id)
      .maybeSingle();
    if (!message) {
      return NextResponse.json({ error: "Mensagem não encontrada." }, { status: 404 });
    }

    const payload = message.interactive_payload as InteractivePollPayload | null;
    if (!payload || payload.kind !== "poll") {
      return NextResponse.json({ error: "Esta mensagem não é uma enquete." }, { status: 400 });
    }
    const option = payload.options[(optionIndex as number) - 1];
    if (!option) {
      return NextResponse.json({ error: "Opção inválida." }, { status: 400 });
    }

    const { data: conversation } = await supabase
      .from("conversations")
      .select("id, channel_id, group:whatsapp_groups(group_jid)")
      .eq("id", message.conversation_id)
      .maybeSingle();
    const groupJid = (conversation?.group as { group_jid?: string } | null)?.group_jid;
    if (!conversation || !groupJid) {
      return NextResponse.json(
        { error: "Votar pelo CRM só está disponível em grupos." },
        { status: 400 },
      );
    }
    // Conversa sem canal (canal antigo removido) cai no canal padrão da conta,
    // igual ao envio de mensagens (`getProviderForConversation`).
    const channelId =
      conversation.channel_id ?? (await resolveDefaultChannelId(supabase, accountId));
    if (!channelId) {
      return NextResponse.json({ error: "A conta não tem canal WhatsApp." }, { status: 400 });
    }

    const { data: channel } = await supabase
      .from("whatsapp_channels")
      .select("id, provider, phone_e164, label")
      .eq("id", channelId)
      .maybeSingle();
    if (!channel || channel.provider !== "uazapi" || !channel.phone_e164) {
      return NextResponse.json(
        { error: "O canal desta conversa não permite votar pelo CRM." },
        { status: 400 },
      );
    }

    // Quem vota é o número conectado, não o usuário do CRM.
    const voterJid = `${String(channel.phone_e164).replace(/\D/g, "")}@s.whatsapp.net`;
    const admin = supabaseAdmin();

    const { data: existing, error: existingError } = await admin
      .from("poll_votes")
      .select("options")
      .eq("message_id", message.id)
      .eq("voter_jid", voterJid)
      .maybeSingle();
    if (existingError) throw existingError;
    if (existing && (existing.options as string[]).length > 0) {
      return NextResponse.json(
        {
          error:
            "Este número já votou nesta enquete. O WhatsApp não troca o voto por esta conexão.",
        },
        { status: 409 },
      );
    }

    const provider = await getProviderForChannel(supabase, channel.id);
    try {
      await provider.votePoll({
        to: groupJid,
        pollMessageId: message.message_id,
        optionIndex: optionIndex as number,
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : "erro desconhecido";
      return NextResponse.json(
        { error: `Não foi possível enviar o voto ao WhatsApp: ${reason}` },
        { status: 502 },
      );
    }

    const result = await applyPollVote(
      admin,
      {
        pollProviderMessageId: message.message_id,
        voterJid,
        voterName: channel.label ?? undefined,
        options: [option],
      },
      accountId,
    );
    if (result !== "applied") {
      return NextResponse.json({ error: "Enquete não encontrada na conta." }, { status: 404 });
    }

    return NextResponse.json({ ok: true, option });
  } catch (err) {
    return toErrorResponse(err);
  }
}

import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { getProviderForChannel } from "@/lib/whatsapp/providers/resolve";
import { brazilianPhoneLookupVariants } from "@/lib/whatsapp/phone-utils";
import { resolveParticipantName } from "@/lib/whatsapp/groups/participant-names";

// ============================================================
// GET /api/whatsapp/conversations/[id]/participants
//
// Painel de participantes na Inbox (não confundir com
// GET /api/whatsapp/groups/[id]/participants, exclusiva de
// Configurações e restrita a admin — aquela existe para GERENCIAR o
// grupo, adicionar/remover gente). Esta é só leitura, para qualquer
// pessoa que tenha a conversa aberta.
//
// A permissão não é checada aqui à mão: a consulta a `conversations`
// passa pela RLS (`can_see_conversation`, migration 20260915000003 +
// 20260916000006), que já decide isso pelos dois eixos
// (conversation_scope + channel_scope) na mesma função usada pela
// Inbox. Sem linha devolvida = sem acesso, tratado como 404 — não
// duplicamos essa lógica numa segunda checagem que poderia divergir.
//
// Lista sempre ao vivo na uazapi (nunca cache local), mesmo princípio
// de .../groups/[id]/participants. Nome de cada participante é
// resolvido aqui (não no cliente) para não expandir a tabela de
// contatos inteira pela rede — ver resolveParticipantName.
// ============================================================

type ParticipantsSupabase = Awaited<ReturnType<typeof createClient>>;

async function resolveAccountId(
  supabase: ParticipantsSupabase,
  userId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("account_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !data?.account_id) return null;
  return data.account_id as string;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const accountId = await resolveAccountId(supabase, user.id);
    if (!accountId) {
      return NextResponse.json(
        { error: "Your profile is not linked to an account." },
        { status: 403 },
      );
    }

    const { data: conversation, error: convError } = await supabase
      .from("conversations")
      .select("id, group_id")
      .eq("id", id)
      .eq("account_id", accountId)
      .maybeSingle();

    if (convError || !conversation) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    if (!conversation.group_id) {
      return NextResponse.json(
        { error: "This conversation is not a group conversation." },
        { status: 400 },
      );
    }

    const { data: group, error: groupError } = await supabase
      .from("whatsapp_groups")
      .select("id, channel_id, group_jid, name, avatar_url, left_at")
      .eq("id", conversation.group_id as string)
      .maybeSingle();

    if (groupError || !group) {
      return NextResponse.json({ error: "Group not found" }, { status: 404 });
    }

    if (group.left_at) {
      // Instituição já saiu deste grupo — sem sessão ativa na uazapi
      // pra listar participantes de verdade. Devolve o grupo com a
      // marca `left` em vez de 404, pra tela distinguir "saímos" de
      // "sem acesso"/"não existe".
      return NextResponse.json({
        group: {
          id: group.id,
          name: group.name,
          avatarUrl: group.avatar_url,
          left: true,
        },
        participants: [],
      });
    }

    let rawParticipants;
    try {
      const provider = await getProviderForChannel(supabase, group.channel_id as string);
      rawParticipants = await provider.getGroupParticipants(group.group_jid as string);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown provider error";
      console.error("[GET .../conversations/[id]/participants] provider error:", message);
      return NextResponse.json({ error: message }, { status: 502 });
    }

    // Nome via Contatos: UMA query com todas as variantes de telefone
    // de TODOS os participantes (com/sem DDI 55, com/sem o nono
    // dígito) — evita N idas ao banco pra um grupo de N pessoas.
    const allVariants = rawParticipants.flatMap((p) =>
      brazilianPhoneLookupVariants(p.phoneNumber),
    );
    const contactNameByVariant = new Map<string, string>();
    if (allVariants.length > 0) {
      const { data: contactRows } = await supabase
        .from("contacts")
        .select("phone_normalized, name")
        .eq("account_id", accountId)
        .in("phone_normalized", allVariants);
      for (const row of contactRows ?? []) {
        if (row.phone_normalized && row.name) {
          contactNameByVariant.set(row.phone_normalized as string, row.name as string);
        }
      }
    }

    // Nome via WhatsApp (fallback): group_participants local, o nome
    // que a própria pessoa configurou, cacheado da última vez que
    // escreveu no grupo.
    const { data: localRows } = await supabase
      .from("group_participants")
      .select("phone, display_name")
      .eq("group_id", group.id as string);
    const localDisplayNameByPhone = new Map<string, string>();
    for (const row of localRows ?? []) {
      if (row.phone && row.display_name) {
        localDisplayNameByPhone.set(row.phone as string, row.display_name as string);
      }
    }

    const participants = rawParticipants.map((p) => ({
      phoneNumber: p.phoneNumber,
      isAdmin: p.isAdmin,
      name: resolveParticipantName(p.phoneNumber, contactNameByVariant, localDisplayNameByPhone),
    }));

    return NextResponse.json({
      group: {
        id: group.id,
        name: group.name,
        avatarUrl: group.avatar_url,
        left: false,
      },
      participants,
    });
  } catch (err) {
    console.error("Error in GET /api/whatsapp/conversations/[id]/participants:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

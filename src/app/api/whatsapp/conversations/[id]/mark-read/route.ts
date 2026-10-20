import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { canSendMessages, isAccountRole, type AccountRole } from "@/lib/auth/roles";
import {
  getProviderForConversation,
  ChannelNotFoundError,
  NoChannelConfiguredError,
} from "@/lib/whatsapp/providers/resolve";
import { ProviderError, ProviderUnsupportedError } from "@/lib/whatsapp/providers/types";
import { pickMessageIdsToMarkRead } from "@/lib/inbox/mark-read";

// ============================================================
// POST /api/whatsapp/conversations/[id]/mark-read — avisa o WhatsApp
// que as mensagens RECEBIDAS ainda não lidas foram lidas (acende o
// "✓✓" azul pra quem enviou). O CRM nunca mandava esse aviso, então o
// cliente nunca via confirmação de leitura mesmo com a secretaria já
// tendo lido no CRM (relato de 20/10/2026).
//
// Só canais uazapi (a Meta Cloud API não expõe essa chamada — a
// confirmação dela é automática, fora do controle do CRM) e só
// conversas individuais por ora — ver spec de 20/10/2026.
// ============================================================

type MessagesSupabase = Awaited<ReturnType<typeof createClient>>;

interface CallerProfile {
  accountId: string;
  role: AccountRole | null;
}

async function resolveCallerProfile(
  supabase: MessagesSupabase,
  userId: string,
): Promise<CallerProfile | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("account_id, account_role")
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !data?.account_id) return null;

  return {
    accountId: data.account_id as string,
    role: isAccountRole(data.account_role) ? data.account_role : null,
  };
}

export async function POST(
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

    const profile = await resolveCallerProfile(supabase, user.id);
    if (!profile) {
      return NextResponse.json(
        { error: "Your profile is not linked to an account." },
        { status: 403 },
      );
    }

    if (!canSendMessages(profile.role ?? "viewer")) {
      return NextResponse.json(
        { error: "You don't have permission to mark messages as read." },
        { status: 403 },
      );
    }

    const { data: conversation, error: convError } = await supabase
      .from("conversations")
      .select("id, account_id, group_id")
      .eq("id", id)
      .eq("account_id", profile.accountId)
      .maybeSingle();

    if (convError || !conversation) {
      return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
    }

    if (conversation.group_id) {
      return NextResponse.json(
        { error: "Marking group messages as read is not supported yet." },
        { status: 400 },
      );
    }

    const { data: messages, error: msgError } = await supabase
      .from("messages")
      .select("id, message_id, sender_type, status")
      .eq("conversation_id", conversation.id);

    if (msgError) {
      console.error("[mark-read] failed to load messages:", msgError.message);
      return NextResponse.json({ error: "Failed to load messages" }, { status: 500 });
    }

    const targetProviderIds = pickMessageIdsToMarkRead(
      (messages ?? []) as {
        message_id: string | null;
        sender_type: "customer" | "agent" | "bot";
        status: "sending" | "sent" | "delivered" | "read" | "failed";
      }[],
    );

    if (targetProviderIds.length === 0) {
      return NextResponse.json({ marked: 0 });
    }

    let provider;
    try {
      provider = await getProviderForConversation(supabase, conversation.id, profile.accountId);
    } catch (err) {
      if (err instanceof NoChannelConfiguredError || err instanceof ChannelNotFoundError) {
        return NextResponse.json({ error: "WhatsApp not configured." }, { status: 400 });
      }
      throw err;
    }

    try {
      await provider.markAsRead({ messageIds: targetProviderIds });
    } catch (err) {
      if (err instanceof ProviderUnsupportedError) {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
      const reason = err instanceof ProviderError ? err.message : "Unknown provider error";
      return NextResponse.json({ error: reason }, { status: 502 });
    }

    const { error: updateError } = await supabase
      .from("messages")
      .update({ status: "read" })
      .eq("conversation_id", conversation.id)
      .in("message_id", targetProviderIds);

    if (updateError) {
      console.error("[mark-read] WhatsApp notified but DB update failed:", updateError.message);
      return NextResponse.json(
        { error: "Marked as read on WhatsApp but failed to update in the database." },
        { status: 500 },
      );
    }

    return NextResponse.json({ marked: targetProviderIds.length });
  } catch (error) {
    console.error("Error in POST .../conversations/[id]/mark-read:", error);
    return NextResponse.json({ error: "Failed to mark conversation as read" }, { status: 500 });
  }
}

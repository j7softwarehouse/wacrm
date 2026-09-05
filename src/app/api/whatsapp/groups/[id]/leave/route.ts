import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { canEditSettings, isAccountRole, type AccountRole } from "@/lib/auth/roles";
import { getProviderForChannel } from "@/lib/whatsapp/providers/resolve";

// ============================================================
// POST /api/whatsapp/groups/[id]/leave — remove o número conectado
// de um grupo real.
//
// A UAZAPI sempre responde sucesso em POST /group/leave, mesmo sem
// efeito (confirmado empiricamente durante a investigação da Fase 3 —
// um incidente real aconteceu por confiar nessa resposta). Por isso
// esta rota reconfirma via listGroups() antes de gravar left_at.
// ============================================================

type GroupsSupabase = Awaited<ReturnType<typeof createClient>>;

interface CallerProfile {
  accountId: string;
  role: AccountRole | null;
}

async function resolveCallerProfile(
  supabase: GroupsSupabase,
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

    if (!profile.role || !canEditSettings(profile.role)) {
      return NextResponse.json(
        { error: "Only account admins can remove the group." },
        { status: 403 },
      );
    }

    const { data: group, error: groupErr } = await supabase
      .from("whatsapp_groups")
      .select("id, channel_id, group_jid")
      .eq("id", id)
      .eq("account_id", profile.accountId)
      .maybeSingle();

    if (groupErr || !group) {
      return NextResponse.json({ error: "Group not found" }, { status: 404 });
    }

    const provider = await getProviderForChannel(supabase, group.channel_id as string);

    await provider.leaveGroup(group.group_jid as string);

    const remaining = await provider.listGroups();
    const stillThere = remaining.some((g) => g.groupJid === group.group_jid);
    if (stillThere) {
      return NextResponse.json(
        {
          error:
            "A uazapi respondeu sucesso mas o grupo continua na lista — tente novamente",
        },
        { status: 502 },
      );
    }

    const { error: updateErr } = await supabase
      .from("whatsapp_groups")
      .update({ left_at: new Date().toISOString(), enabled: false })
      .eq("id", id);

    if (updateErr) {
      console.error("[POST .../leave] update error:", updateErr.message);
      return NextResponse.json({ error: "Failed to record leave" }, { status: 500 });
    }

    return NextResponse.json({ left: true });
  } catch (err) {
    console.error("Error in POST /api/whatsapp/groups/[id]/leave:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

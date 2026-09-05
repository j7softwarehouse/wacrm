import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { canEditSettings, isAccountRole, type AccountRole } from "@/lib/auth/roles";
import { getProviderForChannel } from "@/lib/whatsapp/providers/resolve";

// ============================================================
// GET/POST /api/whatsapp/groups/[id]/participants
//
// GET: lista ao vivo (nunca cache local) + se o número conectado é
// admin. Não exige admin para ler.
//
// POST: add/remove/promote/demote, um telefone por vez. Exige admin.
// O provider já garante que Error != 0 (mesmo com HTTP 200 da uazapi)
// vira exceção — aqui só precisamos mapear pra HTTP.
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

async function loadGroup(
  supabase: GroupsSupabase,
  id: string,
  accountId: string,
) {
  const { data, error } = await supabase
    .from("whatsapp_groups")
    .select("id, channel_id, group_jid, left_at")
    .eq("id", id)
    .eq("account_id", accountId)
    .maybeSingle();
  if (error || !data) return null;
  return data;
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

    const profile = await resolveCallerProfile(supabase, user.id);
    if (!profile) {
      return NextResponse.json(
        { error: "Your profile is not linked to an account." },
        { status: 403 },
      );
    }

    const group = await loadGroup(supabase, id, profile.accountId);
    if (!group || group.left_at) {
      return NextResponse.json({ error: "Group not found" }, { status: 404 });
    }

    const provider = await getProviderForChannel(supabase, group.channel_id as string);
    const [participants, connectedNumber] = await Promise.all([
      provider.getGroupParticipants(group.group_jid as string),
      provider.getConnectedNumber(),
    ]);

    const me = participants.find((p) => p.phoneNumber === connectedNumber);

    return NextResponse.json({
      participants,
      isConnectedNumberAdmin: !!me?.isAdmin,
    });
  } catch (err) {
    console.error("Error in GET .../participants:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

interface PostBody {
  action?: string;
  phone?: string;
}

const VALID_ACTIONS = ["add", "remove", "promote", "demote"] as const;

export async function POST(
  request: Request,
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
        { error: "Only account admins can manage group participants." },
        { status: 403 },
      );
    }

    const body = (await request.json().catch(() => ({}))) as PostBody;
    const { action, phone } = body;

    if (!action || !VALID_ACTIONS.includes(action as (typeof VALID_ACTIONS)[number])) {
      return NextResponse.json(
        { error: `action must be one of: ${VALID_ACTIONS.join(", ")}` },
        { status: 400 },
      );
    }
    if (!phone) {
      return NextResponse.json({ error: "phone is required" }, { status: 400 });
    }

    const group = await loadGroup(supabase, id, profile.accountId);
    if (!group || group.left_at) {
      return NextResponse.json({ error: "Group not found" }, { status: 404 });
    }

    const provider = await getProviderForChannel(supabase, group.channel_id as string);

    try {
      await provider.updateGroupParticipants({
        groupJid: group.group_jid as string,
        action: action as "add" | "remove" | "promote" | "demote",
        phone,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown provider error";
      console.error("[POST .../participants] provider error:", message);
      return NextResponse.json({ error: message }, { status: 502 });
    }

    const participants = await provider.getGroupParticipants(group.group_jid as string);

    return NextResponse.json({ participants });
  } catch (err) {
    console.error("Error in POST .../participants:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

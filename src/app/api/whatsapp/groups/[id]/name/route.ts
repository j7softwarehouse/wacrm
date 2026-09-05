import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { canEditSettings, isAccountRole, type AccountRole } from "@/lib/auth/roles";
import { getProviderForChannel } from "@/lib/whatsapp/providers/resolve";

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

interface PostBody {
  name?: string;
}

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
        { error: "Only account admins can rename the group." },
        { status: 403 },
      );
    }

    const body = (await request.json().catch(() => ({}))) as PostBody;
    const name = body.name?.trim();
    if (!name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    const { data: group, error: groupErr } = await supabase
      .from("whatsapp_groups")
      .select("id, channel_id, group_jid, left_at")
      .eq("id", id)
      .eq("account_id", profile.accountId)
      .maybeSingle();

    if (groupErr || !group || group.left_at) {
      return NextResponse.json({ error: "Group not found" }, { status: 404 });
    }

    const provider = await getProviderForChannel(supabase, group.channel_id as string);

    try {
      await provider.updateGroupName(group.group_jid as string, name);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown provider error";
      console.error("[POST .../name] provider error:", message);
      return NextResponse.json({ error: message }, { status: 502 });
    }

    const { error: updateErr } = await supabase
      .from("whatsapp_groups")
      .update({ name })
      .eq("id", id);

    if (updateErr) {
      console.error("[POST .../name] update error:", updateErr.message);
      return NextResponse.json({ error: "Failed to save name locally" }, { status: 500 });
    }

    return NextResponse.json({ name });
  } catch (err) {
    console.error("Error in POST .../name:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

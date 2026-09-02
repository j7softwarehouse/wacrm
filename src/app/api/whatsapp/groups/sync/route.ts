import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { canEditSettings, isAccountRole, type AccountRole } from "@/lib/auth/roles";
import {
  ChannelNotFoundError,
  getProviderForChannel,
  resolveDefaultChannelId,
} from "@/lib/whatsapp/providers/resolve";
import {
  ProviderError,
  ProviderNotConnectedError,
  ProviderUnsupportedError,
} from "@/lib/whatsapp/providers/types";

// ============================================================
// POST /api/whatsapp/groups/sync — chama `listGroups()` do provider
// do canal e faz upsert em `whatsapp_groups`.
//
// Escrita em `whatsapp_groups` exige admin na RLS (mesma policy
// "admins write groups" da Tarefa 1) — checagem explícita de papel
// abaixo pelo mesmo motivo documentado em `../route.ts`.
//
// Preservar `enabled`: o upsert NUNCA inclui a coluna `enabled` no
// payload. O merge do PostgREST (`Prefer: resolution=merge-duplicates`)
// só sobrescreve as colunas presentes no corpo do upsert — omitindo
// `enabled`, um grupo já existente mantém o valor que o usuário
// configurou, e um grupo novo cai no DEFAULT da coluna (`false`,
// opt-in explícito). Resetar `enabled` a cada sync desligaria grupos
// que o usuário já tinha ligado.
// ============================================================

type SyncSupabase = Awaited<ReturnType<typeof createClient>>;

interface CallerProfile {
  accountId: string;
  role: AccountRole | null;
}

async function resolveCallerProfile(
  supabase: SyncSupabase,
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

interface SyncBody {
  channel_id?: string;
}

export async function POST(request: Request) {
  try {
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
        { error: "Only account admins can sync groups." },
        { status: 403 },
      );
    }

    // Corpo é opcional — sem `channel_id`, cai no canal padrão da
    // conta (mesma resolução usada para conversas outbound-first).
    let body: SyncBody = {};
    try {
      body = (await request.json()) as SyncBody;
    } catch {
      // Sem corpo enviado; segue com o canal padrão.
    }

    const channelId =
      body.channel_id ?? (await resolveDefaultChannelId(supabase, profile.accountId));

    if (!channelId) {
      return NextResponse.json(
        { error: "No WhatsApp channel configured for this account." },
        { status: 400 },
      );
    }

    let groups: Array<{ groupJid: string; name?: string; avatarUrl?: string }>;
    try {
      const provider = await getProviderForChannel(supabase, channelId);
      groups = await provider.listGroups();
    } catch (err) {
      if (err instanceof ChannelNotFoundError) {
        return NextResponse.json({ error: err.message }, { status: 404 });
      }
      if (err instanceof ProviderNotConnectedError) {
        return NextResponse.json({ error: err.message }, { status: 409 });
      }
      if (err instanceof ProviderUnsupportedError) {
        // Ex.: canal Meta, que não expõe grupos na Cloud API.
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
      if (err instanceof ProviderError) {
        return NextResponse.json({ error: err.message }, { status: 502 });
      }
      throw err;
    }

    if (groups.length === 0) {
      return NextResponse.json({ synced: 0 });
    }

    const rows = groups.map((group) => ({
      account_id: profile.accountId,
      channel_id: channelId,
      group_jid: group.groupJid,
      name: group.name ?? null,
      avatar_url: group.avatarUrl ?? null,
      synced_at: new Date().toISOString(),
    }));

    const { data, error } = await supabase
      .from("whatsapp_groups")
      .upsert(rows, { onConflict: "account_id,channel_id,group_jid" })
      .select("id");

    if (error) {
      console.error(
        "[POST /api/whatsapp/groups/sync] upsert error:",
        error.message,
      );
      return NextResponse.json(
        { error: "Failed to sync groups" },
        { status: 500 },
      );
    }

    return NextResponse.json({ synced: data?.length ?? rows.length });
  } catch (err) {
    console.error("Error in POST /api/whatsapp/groups/sync:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

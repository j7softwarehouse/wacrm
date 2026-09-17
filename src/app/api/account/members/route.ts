// ============================================================
// GET /api/account/members
//
// Lists every member of the caller's account. Any member can call
// it (the Members tab is shown to admins+, but agents/viewers see
// a read-only roster too).
//
// Field visibility
//   Sensitive fields (email) are returned only when the caller is
//   admin+. Agents and viewers see name + avatar + role + joined
//   date only. This mirrors the design decision from the planning
//   phase: "agent/viewer sees names only".
// ============================================================

import { NextResponse } from "next/server";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { canManageMembers, isAccountRole } from "@/lib/auth/roles";
import { isConversationScope } from "@/lib/auth/conversation-scope";
import type { AccountMember } from "@/types";

interface ProfileRow {
  user_id: string;
  full_name: string | null;
  email: string | null;
  avatar_url: string | null;
  account_role: string;
  conversation_scope: string | null;
  channel_scope: string | null;
  created_at: string;
}

export async function GET() {
  try {
    const ctx = await getCurrentAccount();

    // RLS on profiles allows reading any row whose account matches
    // the caller's, so this query is naturally account-scoped.
    const { data, error } = await ctx.supabase
      .from("profiles")
      .select(
        "user_id, full_name, email, avatar_url, account_role, conversation_scope, channel_scope, created_at",
      )
      .eq("account_id", ctx.accountId)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("[GET /api/account/members] fetch error:", error);
      return NextResponse.json(
        { error: "Failed to load members" },
        { status: 500 },
      );
    }

    // Um round-trip só, agrupado em memória — evita N+1 quando a conta
    // tem muitos membros. RLS de channel_members já garante que só
    // vêm linhas de canais desta conta (join implícito via
    // whatsapp_channels.account_id).
    const { data: memberRows, error: memberErr } = await ctx.supabase
      .from("channel_members")
      .select("user_id, channel_id");
    if (memberErr) {
      console.error("[GET /api/account/members] channel_members fetch error:", memberErr);
    }
    const channelIdsByUser = new Map<string, string[]>();
    for (const row of memberRows ?? []) {
      const list = channelIdsByUser.get(row.user_id);
      if (list) list.push(row.channel_id);
      else channelIdsByUser.set(row.user_id, [row.channel_id]);
    }

    const canSeeEmails = canManageMembers(ctx.role);

    const members: AccountMember[] = (data as ProfileRow[]).flatMap((row) => {
      // Defensive: the DB enum should never let an unknown role
      // through, but if a migration ever broadens the enum without
      // updating TS, skip the row rather than crash the page.
      if (!isAccountRole(row.account_role)) return [];
      return [
        {
          user_id: row.user_id,
          full_name: row.full_name ?? "",
          email: canSeeEmails ? row.email : null,
          avatar_url: row.avatar_url,
          role: row.account_role,
          conversation_scope: isConversationScope(row.conversation_scope)
            ? row.conversation_scope
            : "all",
          channel_scope: isConversationScope(row.channel_scope)
            ? row.channel_scope
            : "all",
          channel_ids: channelIdsByUser.get(row.user_id) ?? [],
          joined_at: row.created_at,
        },
      ];
    });

    return NextResponse.json({ members });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// ============================================================
// /api/account/members/[userId]/channels
//
//   PATCH — replace which channels a member attends. Admin+.
//
// Delegates to the SECURITY DEFINER RPC set_member_channels (migration
// 20260916000007), which replaces the member's entire channel_members
// list in one transaction (no separate add/remove calls) and validates
// every id belongs to the caller's own account.
// ============================================================

import { NextResponse } from "next/server";
import type { PostgrestError } from "@supabase/supabase-js";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";

function rpcErrorToResponse(err: PostgrestError): NextResponse {
  if (err.code === "42501") {
    return NextResponse.json({ error: err.message }, { status: 403 });
  }
  if (err.code === "22023") {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
  console.error("[members/channels route] unexpected RPC error:", err);
  return NextResponse.json(
    { error: "Failed to update channels" },
    { status: 500 },
  );
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  try {
    const ctx = await requireRole("admin");

    const limit = checkRateLimit(
      `admin:memberChannels:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { userId } = await params;

    const body = (await request.json().catch(() => null)) as
      | { channel_ids?: unknown }
      | null;
    const channelIds = body?.channel_ids;

    if (
      !Array.isArray(channelIds) ||
      !channelIds.every((id) => typeof id === "string")
    ) {
      return NextResponse.json(
        { error: "'channel_ids' must be an array of strings" },
        { status: 400 },
      );
    }

    const { error } = await ctx.supabase.rpc("set_member_channels", {
      p_user_id: userId,
      p_channel_ids: channelIds,
    });

    if (error) return rpcErrorToResponse(error);

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

// ============================================================
// /api/account/members/[userId]/scope
//
//   PATCH — change a member's conversation scope. Admin+.
//
// Delegates to the SECURITY DEFINER RPC set_member_conversation_scope
// (migration 20260915000004) — same shape as .../role's PATCH, which
// delegates to set_member_role. The RPC does the real authorisation:
// caller admin+, target in caller's account, target isn't self, target
// isn't admin/owner (scope doesn't apply to them).
// ============================================================

import { NextResponse } from "next/server";
import type { PostgrestError } from "@supabase/supabase-js";

import { requireRole, toErrorResponse } from "@/lib/auth/account";
import { isConversationScope } from "@/lib/auth/conversation-scope";
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
  console.error("[members/scope route] unexpected RPC error:", err);
  return NextResponse.json(
    { error: "Failed to update conversation scope" },
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
      `admin:memberScope:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const { userId } = await params;

    const body = (await request.json().catch(() => null)) as
      | { scope?: unknown }
      | null;
    const scope = body?.scope;

    if (!isConversationScope(scope)) {
      return NextResponse.json(
        { error: "'scope' must be 'all' or 'assigned'" },
        { status: 400 },
      );
    }

    const { error } = await ctx.supabase.rpc("set_member_conversation_scope", {
      p_user_id: userId,
      p_scope: scope,
    });

    if (error) return rpcErrorToResponse(error);

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

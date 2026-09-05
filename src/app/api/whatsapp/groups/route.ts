import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { canEditSettings, isAccountRole, type AccountRole } from "@/lib/auth/roles";

// ============================================================
// GET /api/whatsapp/groups — lista os grupos da conta do chamador.
// PATCH /api/whatsapp/groups — liga/desliga um grupo (`{ id, enabled }`).
//
// Ponto de atenção: a policy de escrita em `whatsapp_groups`
// (migração 20260829000001, "admins write groups") exige
// `is_account_member(account_id, 'admin')`. Como esta rota usa o
// cliente RLS-scoped da sessão do usuário (não o service role), um
// membro `viewer`/`agent` que tentasse o PATCH veria o `update` do
// Postgres negado pela RLS SEM lançar exceção — a query roda,
// `error` vem null, e nenhuma linha é afetada. Sem a checagem
// explícita de papel abaixo, esse caso devolveria 200 (ou 404, pelo
// `data` vazio do `.select().maybeSingle()`) e o usuário concluiria
// que "não fez nada" sem entender por quê. Por isso verificamos
// `canEditSettings(role)` nós mesmos e devolvemos 403 com mensagem
// clara antes de sequer tentar a escrita.
// ============================================================

type GroupsSupabase = Awaited<ReturnType<typeof createClient>>;

interface CallerProfile {
  accountId: string;
  role: AccountRole | null;
}

/**
 * Resolve `account_id` + `account_role` do perfil do usuário
 * autenticado. Mesmo padrão de `/api/whatsapp/send` e
 * `/api/whatsapp/config` (resolução inline em vez de
 * `getCurrentAccount`), para manter o formato de resposta desta
 * rota sob controle total do handler.
 */
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

export async function GET(_request: Request) {
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

    const { data, error } = await supabase
      .from("whatsapp_groups")
      .select("id, group_jid, name, avatar_url, enabled, left_at")
      .eq("account_id", profile.accountId)
      .order("name", { ascending: true });

    if (error) {
      console.error("[GET /api/whatsapp/groups] fetch error:", error.message);
      return NextResponse.json(
        { error: "Failed to load groups" },
        { status: 500 },
      );
    }

    return NextResponse.json({ groups: data ?? [] });
  } catch (err) {
    console.error("Error in GET /api/whatsapp/groups:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

interface PatchBody {
  id?: string;
  enabled?: boolean;
}

export async function PATCH(request: Request) {
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

    const body = (await request.json()) as PatchBody;
    const { id, enabled } = body;

    if (!id || typeof enabled !== "boolean") {
      return NextResponse.json(
        { error: "id and enabled (boolean) are required" },
        { status: 400 },
      );
    }

    // Ver comentário no topo do arquivo: sem isto, um não-admin recebe
    // um "sucesso" silencioso da RLS.
    if (!profile.role || !canEditSettings(profile.role)) {
      return NextResponse.json(
        { error: "Only account admins can enable or disable groups." },
        { status: 403 },
      );
    }

    const { data, error } = await supabase
      .from("whatsapp_groups")
      .update({ enabled })
      .eq("id", id)
      .eq("account_id", profile.accountId)
      .select("id, group_jid, name, avatar_url, enabled")
      .maybeSingle();

    if (error) {
      console.error("[PATCH /api/whatsapp/groups] update error:", error.message);
      return NextResponse.json(
        { error: "Failed to update group" },
        { status: 500 },
      );
    }

    if (!data) {
      // Ou o id não existe, ou pertence a outra conta — o `.eq`
      // acima já garante tenancy, então tratamos os dois casos como
      // "não encontrado" sem vazar qual dos dois é.
      return NextResponse.json({ error: "Group not found" }, { status: 404 });
    }

    return NextResponse.json({ group: data });
  } catch (err) {
    console.error("Error in PATCH /api/whatsapp/groups:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

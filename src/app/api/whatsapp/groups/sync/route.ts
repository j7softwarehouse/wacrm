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
// configurou, e um grupo novo cai no DEFAULT da coluna (`true` —
// espelha o WhatsApp: já é membro do grupo, já vê as mensagens).
// Resetar `enabled` a cada sync desligaria grupos que o usuário já
// tinha desligado.
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

    // Descobre quais desses grupos estão marcados como "saiu" agora —
    // são os únicos que também ganham `enabled: true` de volta. `left_at`
    // só é gravado JUNTO com `enabled: false` pelas rotas de saída
    // (leave/route.ts e a detecção no envio), nunca separado — então
    // `left_at != null` é o sinal seguro de que o `enabled: false` atual
    // foi causado pela saída, não uma escolha independente do admin
    // (que desligaria um grupo do qual continua membro sem nunca gravar
    // `left_at`). Sem isso, um grupo readicionado voltava com `left_at`
    // limpo mas `enabled` ainda falso — sem "continuidade automática" de
    // verdade, precisava de um clique manual no Switch.
    const groupJids = groups.map((g) => g.groupJid);
    const { data: leftRows } = await supabase
      .from("whatsapp_groups")
      .select("group_jid")
      .eq("account_id", profile.accountId)
      .eq("channel_id", channelId)
      .in("group_jid", groupJids)
      .not("left_at", "is", null);
    const rejoinedJids = new Set(
      (leftRows ?? []).map((r) => r.group_jid as string),
    );

    const baseRow = (group: { groupJid: string; name?: string; avatarUrl?: string }) => ({
      account_id: profile.accountId,
      channel_id: channelId,
      group_jid: group.groupJid,
      name: group.name ?? null,
      avatar_url: group.avatarUrl ?? null,
      synced_at: new Date().toISOString(),
      // Limpa `left_at`: se o grupo aparece em `listGroups()`, o número
      // conectado está nele agora — reabre um grupo re-adicionado após
      // ter saído. Corrida estreita e aceita: um "Sair do grupo" clicado
      // entre o snapshot do listGroups() e este upsert teria seu
      // `left_at` recém-gravado apagado por este sync; janela de
      // segundos, sync roda a cada 10-15min, não justifica lock/ordering.
      left_at: null,
    });

    // Duas chamadas de upsert separadas em vez de uma só com colunas
    // diferentes por linha: o merge do PostgREST (`resolution=merge-
    // duplicates`) monta a lista de colunas do lote a partir da primeira
    // linha — misturar uma linha com `enabled` e outra sem no MESMO
    // upsert arriscaria zerar `enabled` de grupos que não deveriam ser
    // tocados (é exatamente o bug que o comentário do topo do arquivo já
    // avisa para nunca reintroduzir).
    const rejoinedRows = groups
      .filter((g) => rejoinedJids.has(g.groupJid))
      .map((g) => ({ ...baseRow(g), enabled: true }));
    const otherRows = groups
      .filter((g) => !rejoinedJids.has(g.groupJid))
      .map((g) => baseRow(g));

    let synced = 0;
    for (const batch of [rejoinedRows, otherRows]) {
      if (batch.length === 0) continue;
      const { data, error } = await supabase
        .from("whatsapp_groups")
        .upsert(batch, { onConflict: "account_id,channel_id,group_jid" })
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

      synced += data?.length ?? batch.length;
    }

    return NextResponse.json({ synced });
  } catch (err) {
    console.error("Error in POST /api/whatsapp/groups/sync:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

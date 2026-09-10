import { NextResponse } from "next/server";

import { isAuthorizedCronRequest, cronSecret } from "@/lib/cron/auth";
import { supabaseAdmin } from "@/lib/flows/admin-client";
import { getProviderForChannel } from "@/lib/whatsapp/providers/resolve";

// ============================================================
// GET /api/whatsapp/groups/sync-cron — versão automática de
// POST /api/whatsapp/groups/sync (o botão "Sincronizar grupos").
//
// O botão manual sincroniza só o canal padrão da conta de quem
// clicou; esta rota percorre TODOS os canais UAZAPI conectados de
// TODAS as contas, usando o client service-role (não há sessão de
// usuário numa chamada de cron/pinger externo).
//
// Autenticação via isAuthorizedCronRequest: aceita tanto o header
// nativo da Vercel Cron (`Authorization: Bearer $CRON_SECRET`) quanto
// `x-cron-secret` — o plano Hobby só permite cron nativa 1x/dia, então
// esta rota é pensada para ser chamada também por um pinger externo
// (cron-job.org, GitHub Actions, etc.) a cada poucos minutos, sem
// precisar da Vercel Cron para isso.
//
// Preserva `enabled` na maioria dos casos: mesmo motivo da rota manual
// — o upsert de um grupo comum nunca inclui essa coluna, para não
// desligar um grupo que o usuário já tinha configurado. Exceção
// deliberada: um grupo que voltou a aparecer em `listGroups()` DEPOIS
// de ter `left_at` gravado (o número saiu e foi readicionado) também
// ganha `enabled: true` de volta — sem isso, `left_at` seria limpo mas
// o grupo continuaria fora da inbox até alguém religar manualmente.
// ============================================================

interface ChannelRow {
  id: string;
  account_id: string;
}

export async function GET(request: Request) {
  const expected = cronSecret();
  if (!expected) {
    return NextResponse.json({ error: "cron not configured" }, { status: 503 });
  }
  if (!isAuthorizedCronRequest(request, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = supabaseAdmin();

  const { data: channels, error } = await admin
    .from("whatsapp_channels")
    .select("id, account_id")
    .eq("provider", "uazapi")
    .eq("status", "connected");

  if (error) {
    console.error("[GET /api/whatsapp/groups/sync-cron] fetch error:", error.message);
    return NextResponse.json({ error: "Failed to load channels" }, { status: 500 });
  }

  let syncedChannels = 0;
  let syncedGroups = 0;
  const errors: string[] = [];

  for (const channel of (channels ?? []) as ChannelRow[]) {
    try {
      const provider = await getProviderForChannel(admin, channel.id);
      const groups = await provider.listGroups();

      if (groups.length === 0) {
        syncedChannels++;
        continue;
      }

      // Descobre quais desses grupos estão marcados como "saiu" agora —
      // são os únicos que também ganham `enabled: true` de volta. Mesma
      // lógica e mesmo motivo da rota manual (`../sync/route.ts`):
      // `left_at` só é gravado JUNTO com `enabled: false` pelas rotas de
      // saída, nunca separado, então `left_at != null` é o sinal seguro
      // de que o `enabled: false` atual foi causado pela saída.
      const groupJids = groups.map((g) => g.groupJid);
      const { data: leftRows } = await admin
        .from("whatsapp_groups")
        .select("group_jid")
        .eq("account_id", channel.account_id)
        .eq("channel_id", channel.id)
        .in("group_jid", groupJids)
        .not("left_at", "is", null);
      const rejoinedJids = new Set(
        (leftRows ?? []).map((r) => r.group_jid as string),
      );

      const baseRow = (group: { groupJid: string; name?: string; avatarUrl?: string }) => ({
        account_id: channel.account_id,
        channel_id: channel.id,
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
      // diferentes por linha — ver comentário equivalente em
      // `../sync/route.ts` sobre o risco do merge do PostgREST com
      // colunas heterogêneas no mesmo lote.
      const rejoinedRows = groups
        .filter((g) => rejoinedJids.has(g.groupJid))
        .map((g) => ({ ...baseRow(g), enabled: true }));
      const otherRows = groups
        .filter((g) => !rejoinedJids.has(g.groupJid))
        .map((g) => baseRow(g));

      let channelFailed = false;
      let channelSyncedGroups = 0;
      for (const batch of [rejoinedRows, otherRows]) {
        if (batch.length === 0) continue;
        const { error: upsertError } = await admin
          .from("whatsapp_groups")
          .upsert(batch, { onConflict: "account_id,channel_id,group_jid" })
          .select("id");

        if (upsertError) {
          errors.push(`${channel.id}: ${upsertError.message}`);
          channelFailed = true;
          break;
        }
        channelSyncedGroups += batch.length;
      }

      if (channelFailed) continue;

      syncedChannels++;
      syncedGroups += channelSyncedGroups;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `[GET /api/whatsapp/groups/sync-cron] canal ${channel.id} falhou:`,
        message,
      );
      errors.push(`${channel.id}: ${message}`);
    }
  }

  return NextResponse.json({ syncedChannels, syncedGroups, errors });
}

import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { canEditSettings, isAccountRole, type AccountRole } from "@/lib/auth/roles";
import { sanitizePhoneForMeta } from "@/lib/whatsapp/phone-utils";
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

    if (!profile.role || !canEditSettings(profile.role)) {
      return NextResponse.json(
        { error: "Only account admins can view groups." },
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

// ============================================================
// POST /api/whatsapp/groups — cria um grupo novo no canal padrão da
// conta e já grava a linha correspondente em `whatsapp_groups`.
//
// O corpo manda `contactIds`, nunca telefones: o servidor resolve o
// telefone de cada contato ele mesmo (com `.eq("account_id", ...)`
// reforçando o que a RLS de `contacts` já garante), então ninguém
// consegue fazer o número conectado da escola chamar um telefone de
// fora simplesmente forjando o corpo da requisição.
//
// Ordem importa: só grava em `whatsapp_groups` DEPOIS que a UAZAPI
// confirma que o grupo existe de verdade — nunca o contrário. Se a
// gravação no banco falhar depois de o grupo já existir no WhatsApp,
// o grupo fica "órfão" (existe de verdade, mas o CRM ainda não sabe);
// o botão "Sincronizar" que já existe nesta tela recupera esse caso.
// ============================================================

const MAX_GROUP_PARTICIPANTS = 50;

interface PostBody {
  name?: string;
  contactIds?: string[];
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
        { error: "Only account admins can create groups." },
        { status: 403 },
      );
    }

    const body = (await request.json().catch(() => ({}))) as PostBody;
    const name = body.name?.trim() ?? "";
    const contactIds = Array.isArray(body.contactIds) ? body.contactIds : [];

    if (!name) {
      return NextResponse.json({ error: "Group name is required" }, { status: 400 });
    }
    if (name.length > 100) {
      return NextResponse.json(
        { error: "Group name must be at most 100 characters" },
        { status: 400 },
      );
    }
    if (contactIds.length === 0) {
      return NextResponse.json(
        { error: "At least one contact is required" },
        { status: 400 },
      );
    }
    if (contactIds.length > MAX_GROUP_PARTICIPANTS) {
      return NextResponse.json(
        { error: `At most ${MAX_GROUP_PARTICIPANTS} contacts are allowed` },
        { status: 400 },
      );
    }

    const { data: contactRows, error: contactsErr } = await supabase
      .from("contacts")
      .select("id, phone")
      .in("id", contactIds)
      .eq("account_id", profile.accountId);

    if (contactsErr) {
      console.error("[POST /api/whatsapp/groups] contacts fetch error:", contactsErr.message);
      return NextResponse.json({ error: "Failed to resolve contacts" }, { status: 500 });
    }

    // Menos linhas do que ids pedidos = algum id não existe ou é de
    // outra conta (a RLS de `contacts` já barra a segunda hipótese; o
    // `.eq("account_id", ...)` acima é defesa em profundidade, não a
    // única linha de defesa).
    if (!contactRows || contactRows.length !== contactIds.length) {
      return NextResponse.json(
        { error: "One or more contacts could not be found in your account" },
        { status: 400 },
      );
    }

    const participantPhones = contactRows
      .map((c) => sanitizePhoneForMeta((c.phone as string) ?? ""))
      .filter((phone) => phone.length > 0);

    if (participantPhones.length !== contactRows.length) {
      return NextResponse.json(
        { error: "One or more selected contacts have no valid phone number" },
        { status: 400 },
      );
    }

    const channelId = await resolveDefaultChannelId(supabase, profile.accountId);
    if (!channelId) {
      return NextResponse.json(
        { error: "No WhatsApp channel configured for this account." },
        { status: 400 },
      );
    }

    let created;
    try {
      const provider = await getProviderForChannel(supabase, channelId);
      created = await provider.createGroup({ name, participantPhones });
    } catch (err) {
      if (err instanceof ChannelNotFoundError) {
        return NextResponse.json({ error: err.message }, { status: 404 });
      }
      if (err instanceof ProviderNotConnectedError) {
        return NextResponse.json({ error: err.message }, { status: 409 });
      }
      if (err instanceof ProviderUnsupportedError) {
        // Ex.: canal Meta, que não cria grupo pela Cloud API.
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
      if (err instanceof ProviderError) {
        return NextResponse.json({ error: err.message }, { status: 502 });
      }
      throw err;
    }

    const { data: inserted, error: insertErr } = await supabase
      .from("whatsapp_groups")
      .insert({
        account_id: profile.accountId,
        channel_id: channelId,
        group_jid: created.groupJid,
        name: created.name ?? name,
        // O grupo acaba de nascer com o número conectado dentro —
        // entra habilitado direto, sem esperar a primeira mensagem
        // (diferente do que o sync faz para grupos pré-existentes).
        enabled: true,
        synced_at: new Date().toISOString(),
      })
      .select("id, group_jid, name, avatar_url, enabled")
      .single();

    if (insertErr || !inserted) {
      console.error(
        "[POST /api/whatsapp/groups] insert error after group created on WhatsApp:",
        insertErr?.message,
      );
      return NextResponse.json(
        {
          error:
            "The group was created on WhatsApp, but could not be saved. Use \"Sync\" to recover it.",
        },
        { status: 500 },
      );
    }

    return NextResponse.json({ group: inserted, invitedPhones: created.invitedPhones });
  } catch (err) {
    console.error("Error in POST /api/whatsapp/groups:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
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

    // Ao habilitar, limpa `left_at` também: os dois escritores existentes
    // (leave manual e detecção automática de envio rejeitado) sempre
    // gravam `enabled: false` junto com `left_at`, nunca `enabled: true`
    // com `left_at` ainda preenchido — esse estado contraditório só
    // seria possível chamando esta rota diretamente. Defesa em
    // profundidade: a Switch já fica escondida quando `left_at` está
    // preenchido (ver groups-manager.tsx), então isto fecha a lacuna a
    // nível de API sem corrigir nenhum bug de UI alcançável.
    const { data, error } = await supabase
      .from("whatsapp_groups")
      .update(enabled ? { enabled, left_at: null } : { enabled })
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

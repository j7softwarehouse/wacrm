import crypto from "node:crypto";

import { NextResponse } from "next/server";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { encrypt } from "@/lib/whatsapp/encryption";
import { createUazapiClient, normalizeBaseUrl } from "@/lib/whatsapp/uazapi/client";
import type { WhatsAppChannel, WhatsAppProviderKind } from "@/types";

/**
 * A projeção que o cliente pode ver. Tudo que não estiver listado aqui
 * — em especial as colunas de token e o webhook_secret — nunca sai do
 * servidor.
 *
 * `phone_number_id`, `waba_id`, `registered_at` e
 * `last_registration_error` foram incluídos porque a UI de
 * configurações (Meta) os exibe ao admin — são identificadores e
 * metadados de registro, nunca credenciais.
 */
export interface PublicChannel {
  id: string;
  provider: WhatsAppProviderKind;
  label?: string;
  phone_e164?: string;
  status: WhatsAppChannel["status"];
  connected_at?: string;
  last_error?: string;
  phone_number_id?: string;
  waba_id?: string;
  registered_at?: string;
  last_registration_error?: string;
}

export function toPublicChannel(row: WhatsAppChannel): PublicChannel {
  return {
    id: row.id,
    provider: row.provider,
    label: row.label,
    phone_e164: row.phone_e164,
    status: row.status,
    connected_at: row.connected_at,
    last_error: row.last_error,
    phone_number_id: row.phone_number_id,
    waba_id: row.waba_id,
    registered_at: row.registered_at,
    last_registration_error: row.last_registration_error,
  };
}

export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount();

    const { data, error } = await supabase
      .from("whatsapp_channels")
      .select(
        "id, account_id, provider, label, phone_e164, status, connected_at, last_error, phone_number_id, waba_id, registered_at, last_registration_error",
      )
      .eq("account_id", accountId)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("[channels] falha ao listar:", error.message);
      return NextResponse.json(
        { error: "Falha ao carregar os canais." },
        { status: 500 },
      );
    }

    return NextResponse.json({
      channels: (data ?? []).map((row) => toPublicChannel(row as WhatsAppChannel)),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** 32 bytes aleatórios em hex. É a chave de roteamento do inbound. */
export function generateWebhookSecret(): string {
  return crypto.randomBytes(32).toString("hex");
}

interface CreateChannelBody {
  provider: "uazapi";
  label?: string;
  baseUrl: string;
  token: string;
}

export async function POST(request: Request) {
  try {
    const { supabase, accountId, userId } = await getCurrentAccount();
    const body = (await request.json()) as CreateChannelBody;

    if (body.provider !== "uazapi") {
      return NextResponse.json(
        { error: "Apenas canais UAZAPI podem ser criados por aqui." },
        { status: 400 },
      );
    }
    if (!body.baseUrl || !body.token) {
      return NextResponse.json(
        { error: "Informe o subdomínio e o token da instância." },
        { status: 400 },
      );
    }

    let baseUrl: string;
    try {
      baseUrl = normalizeBaseUrl(body.baseUrl);
    } catch {
      return NextResponse.json(
        { error: "Subdomínio ou URL da UAZAPI inválido." },
        { status: 400 },
      );
    }

    // Valida a credencial ANTES de gravar. Credencial errada falha
    // aqui, com mensagem clara, e não deixa linha morta no banco.
    let instanceId: string | undefined;
    try {
      const client = createUazapiClient({ baseUrl, token: body.token });
      const status = await client.get<{ instance?: { id?: string } }>(
        "/instance/status",
      );
      instanceId = status.instance?.id;
    } catch (err) {
      return NextResponse.json(
        {
          error:
            "Não foi possível falar com a instância UAZAPI. Confira o subdomínio e o token. " +
            (err instanceof Error ? err.message : ""),
        },
        { status: 400 },
      );
    }

    const { data, error } = await supabase
      .from("whatsapp_channels")
      .insert({
        account_id: accountId,
        // NOT NULL audit column since 001/017 — identifica qual membro
        // da conta cadastrou o canal (mesmo papel que config/route.ts
        // já preenche para canais Meta).
        user_id: userId,
        provider: "uazapi",
        label: body.label ?? null,
        uazapi_base_url: baseUrl,
        uazapi_token: encrypt(body.token),
        uazapi_instance_id: instanceId ?? null,
        webhook_secret: generateWebhookSecret(),
        status: "disconnected",
      })
      .select()
      .single();

    if (error) {
      // 23505 = violação de índice único. Aqui só pode ser a instância
      // já reivindicada por outra conta.
      if ((error as { code?: string }).code === "23505") {
        return NextResponse.json(
          { error: "Esta instância UAZAPI já está vinculada a outra conta." },
          { status: 409 },
        );
      }
      console.error("[channels] falha ao criar:", error.message);
      return NextResponse.json(
        { error: "Não foi possível salvar o canal." },
        { status: 500 },
      );
    }

    return NextResponse.json({ channel: toPublicChannel(data as WhatsAppChannel) });
  } catch (err) {
    return toErrorResponse(err);
  }
}

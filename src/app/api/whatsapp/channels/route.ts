import { NextResponse } from "next/server";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
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

import { NextResponse } from "next/server";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";

/**
 * Remove um canal. As conversas dele **não** são apagadas: a FK usa
 * ON DELETE SET NULL, então elas ficam como histórico somente-leitura.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { supabase, accountId } = await getCurrentAccount();
    const { id } = await params;

    const { error } = await supabase
      .from("whatsapp_channels")
      .delete()
      .eq("id", id)
      .eq("account_id", accountId);

    if (error) {
      console.error("[channels] falha ao remover:", error.message);
      return NextResponse.json(
        { error: "Não foi possível remover o canal." },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

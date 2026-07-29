import { NextResponse } from "next/server";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { mergeOrphanedConversations } from "@/lib/whatsapp/merge-orphaned-conversations";

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

    // Sem isso, um contato com conversa órfã de um canal já removido
    // e conversa ativa neste canal colidiria em
    // idx_conversations_account_contact_channel assim que o ON DELETE
    // SET NULL zerasse o channel_id desta última — 500 visto em
    // produção ao remover o segundo canal de teste de um mesmo contato.
    await mergeOrphanedConversations(supabase, accountId, id);

    // `.select()` no DELETE é o que distingue "apagou" de "a RLS
    // bloqueou". A política `admins write channels` (037) não devolve
    // erro para um membro comum: devolve zero linhas afetadas. Sem
    // conferir isso, a UI dizia "removido" e o canal reaparecia no
    // refresh seguinte.
    const { data: deleted, error } = await supabase
      .from("whatsapp_channels")
      .delete()
      .eq("id", id)
      .eq("account_id", accountId)
      .select("id");

    if (error) {
      console.error("[channels] falha ao remover:", error.message);
      return NextResponse.json(
        { error: "Não foi possível remover o canal." },
        { status: 500 },
      );
    }

    if (!deleted || deleted.length === 0) {
      return NextResponse.json(
        { error: "Canal não encontrado ou você não tem permissão para removê-lo." },
        { status: 404 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

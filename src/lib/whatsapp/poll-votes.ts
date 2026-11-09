// ============================================================
// Votos de enquete: grava um voto e recalcula a contagem da enquete.
//
// Uma linha em `poll_votes` por pessoa por enquete. Quando a pessoa troca
// o voto, a linha é sobrescrita; quando desmarca tudo, a linha some. A
// contagem vai para `messages.poll_results`, que a bolha lê pelo realtime.
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { InteractivePollPayload } from "./interactive";
import type { PollVoteEvent } from "./uazapi/normalize";

export interface PollResults {
  /** Quantas pessoas votaram em pelo menos uma opção. */
  total: number;
  /** Votos por opção, na ordem do payload da enquete. */
  counts: Record<string, number>;
}

/** Conta os votos atuais. Quem não marcou nada não entra no total. */
export function countPollVotes(
  options: string[],
  votes: { options: string[] }[],
): PollResults {
  const counts: Record<string, number> = {};
  for (const option of options) counts[option] = 0;

  let total = 0;
  for (const vote of votes) {
    if (vote.options.length === 0) continue;
    total++;
    for (const option of vote.options) {
      if (option in counts) counts[option]++;
    }
  }
  return { total, counts };
}

export type ApplyPollVoteResult = "applied" | "unknown_poll";

/**
 * Aplica um voto. Retorna `unknown_poll` quando a enquete não está na conta
 * (voto de uma enquete que não foi enviada por este CRM).
 */
export async function applyPollVote(
  db: SupabaseClient,
  vote: PollVoteEvent,
  accountId: string,
): Promise<ApplyPollVoteResult> {
  const { data: message, error: messageError } = await db
    .from("messages")
    .select("id, interactive_payload, conversations!inner(account_id)")
    .eq("message_id", vote.pollProviderMessageId)
    .eq("conversations.account_id", accountId)
    .maybeSingle();

  if (messageError) throw messageError;
  if (!message) return "unknown_poll";

  const payload = message.interactive_payload as InteractivePollPayload | null;
  if (!payload || payload.kind !== "poll") return "unknown_poll";

  // Opção que não existe na enquete é ignorada, não gravada.
  const options = vote.options.filter((o) => payload.options.includes(o));

  if (options.length === 0) {
    const { error } = await db
      .from("poll_votes")
      .delete()
      .eq("message_id", message.id)
      .eq("voter_jid", vote.voterJid);
    if (error) throw error;
  } else {
    const { error } = await db.from("poll_votes").upsert(
      {
        message_id: message.id,
        voter_jid: vote.voterJid,
        voter_name: vote.voterName ?? null,
        options,
        voted_at: new Date().toISOString(),
      },
      { onConflict: "message_id,voter_jid" },
    );
    if (error) throw error;
  }

  const { data: rows, error: rowsError } = await db
    .from("poll_votes")
    .select("options")
    .eq("message_id", message.id);
  if (rowsError) throw rowsError;

  const results = countPollVotes(payload.options, rows ?? []);
  const { error: updateError } = await db
    .from("messages")
    .update({ poll_results: results })
    .eq("id", message.id);
  if (updateError) throw updateError;

  return "applied";
}

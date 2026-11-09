// ============================================================
// Quem votou em cada opção de uma enquete, para o "Mostrar votos".
// ============================================================

export interface PollVoteRow {
  voter_jid: string;
  voter_name: string | null;
  options: string[];
  voted_at: string;
}

/**
 * Nome exibido de quem votou: o nome do contato no WhatsApp, senão o
 * telefone. Um votante só com @lid (sem telefone resolvido) aparece como
 * "Participante".
 */
export function formatVoterLabel(voterName: string | null, voterJid: string): string {
  const name = voterName?.trim();
  if (name) return name;
  // Só JID de telefone (@s.whatsapp.net) traz número de verdade; o @lid
  // tem dígitos mas é um identificador opaco.
  if (!voterJid.endsWith("@s.whatsapp.net")) return "Participante";
  const user = voterJid.split("@")[0] ?? "";
  return /^\d+$/.test(user) ? `+${user}` : "Participante";
}

/** Nomes de quem votou em cada opção, na ordem em que votaram. */
export function groupVotersByOption(
  options: string[],
  votes: PollVoteRow[],
): Record<string, string[]> {
  const groups: Record<string, string[]> = {};
  for (const option of options) groups[option] = [];

  const ordered = [...votes].sort((a, b) => a.voted_at.localeCompare(b.voted_at));
  for (const vote of ordered) {
    const label = formatVoterLabel(vote.voter_name, vote.voter_jid);
    for (const option of vote.options) {
      if (option in groups) groups[option].push(label);
    }
  }
  return groups;
}

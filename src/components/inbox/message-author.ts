/**
 * Decide se o balão deve estampar o nome de quem enviou.
 *
 * Repetir o autor em toda mensagem polui a leitura; o que resolve a dor
 * real ("onde termina o atendimento de um operador e começa o do
 * outro") é marcar a TROCA. Por isso o nome só aparece quando o autor
 * muda em relação à mensagem imediatamente anterior.
 */
export interface AuthorableMessage {
  sender_type: 'agent' | 'customer';
  sender_id: string | null;
}

export function shouldShowAuthor(
  current: AuthorableMessage,
  previous: AuthorableMessage | null,
): boolean {
  // Mensagem do contato nunca leva autor: quem falou é o próprio
  // contato, já identificado pelo cabeçalho da conversa.
  if (current.sender_type !== 'agent') return false;
  if (!previous) return true;
  if (previous.sender_type !== 'agent') return true;
  return previous.sender_id !== current.sender_id;
}

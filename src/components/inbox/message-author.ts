/**
 * Decide se o balão deve estampar o nome de quem enviou.
 *
 * Todo balão de agente leva o nome do autor. A regra anterior só marcava
 * a TROCA de operador, o que deixava sequências inteiras sem
 * identificação — numa conversa em que o mesmo atendente responde várias
 * vezes seguidas, ninguém consegue dizer quem está falando sem rolar até
 * o início do bloco. Identificar sempre custa uma linha discreta por
 * balão e resolve a dor real.
 */
export interface AuthorableMessage {
  sender_type: 'agent' | 'customer';
  sender_id: string | null;
}

export function shouldShowAuthor(current: AuthorableMessage): boolean {
  // Mensagem do contato nunca leva autor: quem falou é o próprio
  // contato, já identificado pelo cabeçalho da conversa.
  return current.sender_type === 'agent';
}

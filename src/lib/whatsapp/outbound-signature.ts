/**
 * Prefixa uma mensagem de saída com o nome do atendente humano, em
 * negrito nativo do WhatsApp, para o contato saber quem está
 * respondendo. Sem nome, retorna o texto original — nunca produz
 * um prefixo vazio (`*:*`).
 */
export function withAgentSignature(
  fullName: string | null,
  text: string
): string {
  if (!fullName) return text;
  return `*${fullName}:*\n${text}`;
}

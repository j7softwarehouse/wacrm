/**
 * Procedência do contato. Existe como coluna, e não como tag, porque
 * tag é editável e some sem rastro no meio das tags de uso cotidiano
 * (turma, assunto) — enquanto a origem é um fato sobre como o contato
 * entrou no sistema.
 */
export const CONTACT_SOURCE = {
  /** Criado pelo webhook a partir de mensagem recebida. */
  WHATSAPP: 'whatsapp',
  /** Veio da lista importada da organização. */
  IMPORT: 'import',
  /** Cadastrado à mão na tela. */
  MANUAL: 'manual',
} as const;

export type ContactSource =
  (typeof CONTACT_SOURCE)[keyof typeof CONTACT_SOURCE];

/**
 * Contato que ninguém identificou ainda — só o nome de perfil que o
 * WhatsApp entregou. É o que a secretaria precisa enxergar de relance.
 * Origem ausente é tratada como não identificada: linha anterior à
 * migração é exatamente esse caso.
 */
export function isUnidentified(source: string | null | undefined): boolean {
  return source !== CONTACT_SOURCE.IMPORT && source !== CONTACT_SOURCE.MANUAL;
}

// ============================================================
// Escopo de conversas — pure, unit-testable, no I/O.
//
// Espelha exatamente as funções SQL de
// supabase/migrations/20260915000003_conversation_scope.sql
// (`can_see_conversation`, `can_write_conversation`,
// `can_start_conversation`) — quem muda uma precisa mudar a outra, ou
// a interface e a RLS divergem sobre o que o usuário pode fazer.
//
// Por que é um eixo separado do papel, não um quinto valor de
// `AccountRole`: o perfil "responde só o que foi atribuído a ele"
// ESCREVE MAIS que o `viewer` e ENXERGA MENOS que o `agent` comum —
// não tem posição possível numa hierarquia ordinal onde quem está
// acima herda tudo de quem está abaixo. Ver
// docs/superpowers/specs/2026-09-15-escopo-de-conversas-design.md.
// ============================================================

import { hasMinRole, type AccountRole } from "./roles";

export type ConversationScope = "all" | "assigned";

export function isConversationScope(value: unknown): value is ConversationScope {
  return value === "all" || value === "assigned";
}

/**
 * admin/owner sempre enxergam tudo — o escopo é ignorado de propósito
 * para os dois, para que marcar um administrador como restrito por
 * engano nunca o tranque fora da própria conta.
 */
function scopeIgnored(role: AccountRole): boolean {
  return role === "admin" || role === "owner";
}

/**
 * Quem pode VER a conversa. `assignedAgentId` nulo (ninguém atribuído
 * ainda) fica fora do alcance de quem tem escopo de conversa restrito.
 *
 * `isMemberOfChannel` é pré-computado pelo chamador (o SQL faz o
 * mesmo `EXISTS` internamente via `channel_members`) — um
 * `channel_id` nulo (canal removido) nunca bate contra nenhuma
 * membership, então chega aqui como `false`, e uma conversa órfã fica
 * fora do alcance de quem tem escopo de canal restrito. Ver
 * docs/superpowers/specs/2026-09-16-restricao-por-canal-design.md §5.
 */
export function canSeeConversation(
  role: AccountRole,
  scope: ConversationScope,
  assignedAgentId: string | null,
  userId: string,
  channelScope: ConversationScope,
  isMemberOfChannel: boolean,
): boolean {
  return (
    (scopeIgnored(role) ||
      scope === "all" ||
      (assignedAgentId !== null && assignedAgentId === userId)) &&
    (scopeIgnored(role) || channelScope === "all" || isMemberOfChannel)
  );
}

/** Quem pode ESCREVER na conversa: exige `agent`+ (viewer nunca
 *  escreve, mesmo com escopo total) E estar dentro dos dois escopos. */
export function canWriteConversation(
  role: AccountRole,
  scope: ConversationScope,
  assignedAgentId: string | null,
  userId: string,
  channelScope: ConversationScope,
  isMemberOfChannel: boolean,
): boolean {
  return (
    hasMinRole(role, "agent") &&
    canSeeConversation(role, scope, assignedAgentId, userId, channelScope, isMemberOfChannel)
  );
}

/**
 * Quem pode INICIAR (ou apagar) uma conversa NUM CANAL ESPECÍFICO:
 * sempre exige escopo de conversa total, mesmo para quem já tem
 * `agent`+ — quem tem escopo restrito responde o que chega, não
 * inicia. `isMemberOfChannel` tem a mesma forma e o mesmo
 * pré-cômputo de `canSeeConversation`/`canWriteConversation`: true
 * quando o canal em questão está entre os que o usuário atende.
 *
 * O único chamador de hoje (`useCan('start-conversation')`, o gate
 * grosso que decide só se MOSTRA o botão "Conversar") ainda não sabe
 * qual canal será escolhido — passa `isMemberOfChannel = true` de
 * propósito, o que faz este eixo não influenciar aquele gate grosso
 * (a restrição de canal de verdade acontece depois, filtrando a lista
 * de canais e na política de INSERT do banco — ver
 * docs/superpowers/specs/2026-09-16-restricao-por-canal-design.md §6).
 */
export function canStartConversation(
  role: AccountRole,
  scope: ConversationScope,
  channelScope: ConversationScope,
  isMemberOfChannel: boolean,
): boolean {
  return (
    hasMinRole(role, "agent") &&
    (scopeIgnored(role) || scope === "all") &&
    (scopeIgnored(role) || channelScope === "all" || isMemberOfChannel)
  );
}

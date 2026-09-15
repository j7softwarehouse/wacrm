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

/** Quem pode VER a conversa. `assignedAgentId` nulo (ninguém
 *  atribuído ainda) fica fora do alcance de quem tem escopo restrito. */
export function canSeeConversation(
  role: AccountRole,
  scope: ConversationScope,
  assignedAgentId: string | null,
  userId: string,
): boolean {
  return (
    scopeIgnored(role) ||
    scope === "all" ||
    (assignedAgentId !== null && assignedAgentId === userId)
  );
}

/** Quem pode ESCREVER na conversa: exige `agent`+ (viewer nunca
 *  escreve, mesmo com escopo total) E estar dentro do escopo. */
export function canWriteConversation(
  role: AccountRole,
  scope: ConversationScope,
  assignedAgentId: string | null,
  userId: string,
): boolean {
  return hasMinRole(role, "agent") && canSeeConversation(role, scope, assignedAgentId, userId);
}

/**
 * Quem pode INICIAR (ou apagar) uma conversa: sempre exige escopo
 * total, mesmo para quem já tem `agent`+. Quem tem escopo restrito
 * responde o que chega, não inicia — mesma regra que fecha o botão
 * "Conversar" de Contatos pelo lado do banco.
 */
export function canStartConversation(role: AccountRole, scope: ConversationScope): boolean {
  return hasMinRole(role, "agent") && (scopeIgnored(role) || scope === "all");
}

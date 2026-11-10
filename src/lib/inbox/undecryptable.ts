// ============================================================
// Detecta a mensagem-placeholder que a própria uazapi grava quando não
// consegue decifrar uma mídia recebida (criptografia multiaparelho
// dessincronizada — falha conhecida do WhatsApp multiaparelho, não bug
// deste CRM). Texto real confirmado em produção (2026-10-01):
// "[Undecryptable] [media] [image] Não foi possível descriptografar a
// mensagem. Abra o WhatsApp no seu celular para visualizá-la."
//
// Usado pra oferecer o botão de "tentar recuperar"
// (.../messages/[id]/request-recovery) só nas mensagens que
// realmente precisam dele.
// ============================================================

import { canEditSettings, type AccountRole } from "@/lib/auth/roles";

export function isUndecryptablePlaceholder(text: string | null | undefined): boolean {
  if (!text) return false;
  return text.trim().toLowerCase().startsWith("[undecryptable]");
}

/**
 * Decide se o botão "Tentar recuperar" aparece numa mensagem. Mesma regra
 * de permissão da rota .../request-recovery (canEditSettings: admin ou
 * owner), para o cliente e o servidor não divergirem. Papel `null` (perfil
 * ainda carregando) conta como sem permissão.
 */
export function canRequestMessageRecovery(input: {
  role: AccountRole | null;
  senderType: string | null | undefined;
  contentText: string | null | undefined;
  deletedAt?: string | null;
}): boolean {
  if (input.deletedAt) return false;
  if (input.senderType !== "customer") return false;
  if (!isUndecryptablePlaceholder(input.contentText)) return false;
  return canEditSettings(input.role ?? "viewer");
}

/**
 * Traduz a resposta da rota de recuperação numa chave de mensagem para o
 * usuário. Nunca usa o texto devolvido pelo servidor: ele pode citar o
 * fornecedor (ex.: "uazapi") ou vir em inglês, e isso não pode aparecer
 * para o cliente.
 */
export type RecoveryErrorKey = "forbidden" | "noAnchor" | "failed";

export function recoveryErrorKey(
  status: number,
  code?: string | null,
): RecoveryErrorKey {
  if (status === 403) return "forbidden";
  if (status === 400 && code === "no_anchor") return "noAnchor";
  return "failed";
}

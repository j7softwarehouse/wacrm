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

export function isUndecryptablePlaceholder(text: string | null | undefined): boolean {
  if (!text) return false;
  return text.trim().toLowerCase().startsWith("[undecryptable]");
}

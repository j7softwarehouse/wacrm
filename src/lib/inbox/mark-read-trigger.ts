/** Quanto tempo a pessoa precisa ficar olhando a conversa (aba visível)
 *  antes do primeiro aviso de leitura — passar o olho rápido pela lista
 *  não pode acender o "✓✓" azul pro contato. */
export const MARK_READ_DWELL_MS = 2000;

/** Depois que a conversa já está "lida", mensagens novas chegando em
 *  rajada são agrupadas num só aviso — mais curto que o dwell porque
 *  aqui a pessoa já está demonstradamente olhando a conversa. */
export const MARK_READ_DEBOUNCE_MS = 1200;

export function isMarkReadEligible(args: {
  conversationId: string | undefined;
  channelProvider: string | undefined;
  isGroup: boolean;
  canSendMessages: boolean;
}): boolean {
  return (
    !!args.conversationId &&
    args.channelProvider === "uazapi" &&
    !args.isGroup &&
    args.canSendMessages
  );
}

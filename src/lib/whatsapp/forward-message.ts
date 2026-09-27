import type { SupabaseClient } from "@supabase/supabase-js";

import {
  SendMessageError,
  sendMessageToConversation,
} from "@/lib/whatsapp/send-message";
import { ProviderRateLimitError } from "@/lib/whatsapp/providers/types";

// ============================================================
// forwardOneMessage — encaminha UMA mensagem pra UM destino.
//
// Extraído da rota de encaminhamento (originalmente
// api/whatsapp/messages/[id]/forward/route.ts) pra ser reaproveitado
// tanto no encaminhamento de 1 mensagem quanto no de um LOTE de várias
// (api/whatsapp/messages/forward/route.ts) — o laço duplo (destino ×
// mensagem) e o disjuntor de limite de taxa ficam no chamador; esta
// função só sabe fazer UM envio e reportar se foi limite de provedor.
// ============================================================

export interface ForwardableMessage {
  id: string;
  content_type: string;
  content_text: string | null;
  media_url: string | null;
}

export interface ForwardOneMessageResult {
  ok: boolean;
  error?: string;
  /** true quando a falha foi limite de taxa do provedor — o chamador
   *  decide parar o lote inteiro nesse caso, nunca só pular este item. */
  isRateLimit?: boolean;
}

/** Documento não guarda o nome do arquivo em coluna própria (só a
 *  legenda vai para `content_text`), então o nome real vem do último
 *  segmento da URL de storage — é o mesmo nome com que o arquivo foi
 *  salvo no upload. */
function filenameFromUrl(url: string): string | undefined {
  try {
    const path = new URL(url).pathname;
    const last = path.split("/").pop();
    return last ? decodeURIComponent(last) : undefined;
  } catch {
    return undefined;
  }
}

export async function forwardOneMessage(
  db: SupabaseClient,
  accountId: string,
  userId: string,
  message: ForwardableMessage,
  destinationConversationId: string,
  note: string | undefined,
): Promise<ForwardOneMessageResult> {
  const trimmedNote = note?.trim() || undefined;
  const contentType = message.content_type;

  const filename =
    contentType === "document" && message.media_url
      ? filenameFromUrl(message.media_url)
      : undefined;

  // A nota vira LEGENDA da própria mensagem encaminhada sempre que o
  // tipo aceita legenda — um balão só, pedido do usuário depois de ver
  // dois balões separados na prática ("gera confusão"). Áudio é a
  // única exceção real: o WhatsApp recusa legenda em áudio (mesma
  // regra de `message-composer.tsx`), então a nota tem que sair como
  // mensagem de texto à parte nesse caso específico.
  const noteMustBeSeparateMessage = !!trimmedNote && contentType === "audio";
  const combinedContentText =
    trimmedNote && !noteMustBeSeparateMessage
      ? message.content_text
        ? `${message.content_text}\n\n${trimmedNote}`
        : trimmedNote
      : (message.content_text ?? null);

  try {
    const forwardResult = await sendMessageToConversation(db, accountId, {
      conversationId: destinationConversationId,
      messageType: contentType,
      contentText: combinedContentText,
      mediaUrl: message.media_url ?? null,
      filename: filename ?? null,
      senderUserId: userId,
      forwarded: true,
    });

    // A nota foi anexada ao MESMO content_text que acabou de ser
    // enviado — grava separada também, só pra bolha do CRM saber onde
    // o trecho digitado pelo atendente começa (ver migration
    // 20260915000001). Não falha o encaminhamento se isto der errado:
    // é cosmético, o conteúdo real já saiu certo.
    if (trimmedNote && !noteMustBeSeparateMessage) {
      await db
        .from("messages")
        .update({ forwarded_note: trimmedNote })
        .eq("id", forwardResult.messageId);
    }

    // Só chega aqui quando a nota NÃO pôde ir junto (áudio). Tenta
    // DEPOIS do encaminhamento ter saído — se ela falhar, o destino
    // inteiro conta como falho: pro atendente, "encaminhar com uma
    // mensagem" é uma entrega só.
    if (noteMustBeSeparateMessage) {
      await sendMessageToConversation(db, accountId, {
        conversationId: destinationConversationId,
        messageType: "text",
        contentText: trimmedNote,
        senderUserId: userId,
      });
    }

    return { ok: true };
  } catch (err) {
    const isRateLimit = err instanceof ProviderRateLimitError;
    const reason =
      err instanceof SendMessageError || err instanceof Error
        ? err.message
        : "Unknown error";
    return { ok: false, error: reason, isRateLimit };
  }
}

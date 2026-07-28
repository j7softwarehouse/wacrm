// ============================================================
// Provider UAZAPI.
//
// Traduz a interface do CRM para os endpoints da UAZAPI. Duas
// diferenças de vocabulário merecem atenção porque não são
// adivinháveis:
//   - a legenda de mídia vai em `text`, não em `caption`
//   - em /message/react o emoji vai em `text` e o alvo em `id`
// ============================================================

import { createUazapiClient } from "@/lib/whatsapp/uazapi/client";
import { storeInboundMedia } from "@/lib/storage/store-inbound-media";

import {
  ProviderUnsupportedError,
  type SendInteractiveButtonsArgs,
  type SendInteractiveListArgs,
  type SendMediaArgs,
  type SendReactionArgs,
  type SendResult,
  type SendTextArgs,
  type WhatsAppProvider,
} from "./types";

export interface UazapiProviderConfig {
  baseUrl: string;
  token: string;
  /** Necessário para gravar mídia recebida no bucket certo. */
  accountId: string;
}

/** A UAZAPI devolve `messageid`; o CRM usa `messageId`. */
interface UazapiSendResponse {
  messageid?: string;
  id?: string;
}

function toSendResult(response: UazapiSendResponse): SendResult {
  return { messageId: response.messageid ?? response.id ?? "" };
}

export function createUazapiProvider(
  config: UazapiProviderConfig,
): WhatsAppProvider {
  const client = createUazapiClient({
    baseUrl: config.baseUrl,
    token: config.token,
  });

  return {
    kind: "uazapi",

    async sendText(args: SendTextArgs): Promise<SendResult> {
      const body: Record<string, unknown> = { number: args.to, text: args.text };
      if (args.contextMessageId) body.replyid = args.contextMessageId;
      return toSendResult(await client.post<UazapiSendResponse>("/send/text", body));
    },

    async sendMedia(args: SendMediaArgs): Promise<SendResult> {
      const body: Record<string, unknown> = {
        number: args.to,
        type: args.kind,
        file: args.link,
      };
      if (args.caption) body.text = args.caption;
      if (args.filename) body.docName = args.filename;
      if (args.contextMessageId) body.replyid = args.contextMessageId;
      return toSendResult(await client.post<UazapiSendResponse>("/send/media", body));
    },

    async sendInteractiveButtons(
      args: SendInteractiveButtonsArgs,
    ): Promise<SendResult> {
      // /send/menu recebe `choices` como títulos. O id estável dos
      // botões do CRM não tem equivalente: a resposta do cliente volta
      // em `buttonOrListid` com o título tocado, e é isso que a
      // normalização usa para casar com o botão.
      const body: Record<string, unknown> = {
        number: args.to,
        type: "button",
        text: args.bodyText,
        choices: args.buttons.map((b) => b.title),
      };
      if (args.footerText) body.footerText = args.footerText;
      if (args.contextMessageId) body.replyid = args.contextMessageId;
      return toSendResult(await client.post<UazapiSendResponse>("/send/menu", body));
    },

    async sendInteractiveList(args: SendInteractiveListArgs): Promise<SendResult> {
      const choices = args.sections.flatMap((section) =>
        section.rows.map((row) => row.title),
      );
      const body: Record<string, unknown> = {
        number: args.to,
        type: "list",
        text: args.bodyText,
        listButton: args.buttonLabel,
        choices,
      };
      if (args.footerText) body.footerText = args.footerText;
      if (args.contextMessageId) body.replyid = args.contextMessageId;
      return toSendResult(await client.post<UazapiSendResponse>("/send/menu", body));
    },

    async sendReaction(args: SendReactionArgs): Promise<SendResult> {
      return toSendResult(
        await client.post<UazapiSendResponse>("/message/react", {
          number: args.to,
          id: args.targetMessageId,
          text: args.emoji,
        }),
      );
    },

    async sendTemplate(): Promise<SendResult> {
      // Templates aprovados são um conceito exclusivo da Meta. A UI
      // esconde a funcionalidade em canais UAZAPI; isto é a rede de
      // proteção para um caminho que não deveria ser alcançável.
      throw new ProviderUnsupportedError("uazapi", "sendTemplate");
    },

    async resolveInboundMediaUrl(ref: string): Promise<string | null> {
      // A UAZAPI entrega `fileURL` pronto, mas URLs de mídia do
      // WhatsApp expiram — guardar o link cru deixaria o histórico
      // quebrado em poucas horas. Baixa uma vez e guarda no Storage.
      if (!ref) return null;
      return storeInboundMedia(config.accountId, ref);
    },
  };
}

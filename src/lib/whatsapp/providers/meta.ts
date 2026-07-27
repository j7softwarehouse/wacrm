// ============================================================
// Adapter da Meta — invólucro fino sobre `meta-api.ts`.
//
// NÃO contém lógica: só injeta as credenciais do canal e repassa.
// `meta-api.ts` permanece intocado de propósito — é o arquivo que
// mais conflita em merges com o remote `upstream`.
// ============================================================

import {
  sendInteractiveButtons as metaSendInteractiveButtons,
  sendInteractiveList as metaSendInteractiveList,
  sendMediaMessage,
  sendReactionMessage,
  sendTemplateMessage,
  sendTextMessage,
} from "@/lib/whatsapp/meta-api";
import type { MessageTemplate } from "@/types";
import type { SendTimeParams } from "@/lib/whatsapp/template-send-builder";

import type {
  SendInteractiveButtonsArgs,
  SendInteractiveListArgs,
  SendMediaArgs,
  SendReactionArgs,
  SendResult,
  SendTemplateArgs,
  SendTextArgs,
  WhatsAppProvider,
} from "./types";

export interface MetaProviderConfig {
  phoneNumberId: string;
  accessToken: string;
}

export function createMetaProvider(config: MetaProviderConfig): WhatsAppProvider {
  const { phoneNumberId, accessToken } = config;
  const creds = { phoneNumberId, accessToken };

  return {
    kind: "meta",

    async sendText(args: SendTextArgs): Promise<SendResult> {
      return sendTextMessage({
        ...creds,
        to: args.to,
        text: args.text,
        contextMessageId: args.contextMessageId,
      });
    },

    async sendMedia(args: SendMediaArgs): Promise<SendResult> {
      return sendMediaMessage({
        ...creds,
        to: args.to,
        kind: args.kind,
        link: args.link,
        caption: args.caption,
        filename: args.filename,
        contextMessageId: args.contextMessageId,
      });
    },

    async sendInteractiveButtons(
      args: SendInteractiveButtonsArgs,
    ): Promise<SendResult> {
      return metaSendInteractiveButtons({
        ...creds,
        to: args.to,
        bodyText: args.bodyText,
        headerText: args.headerText,
        footerText: args.footerText,
        buttons: args.buttons,
        contextMessageId: args.contextMessageId,
      });
    },

    async sendInteractiveList(args: SendInteractiveListArgs): Promise<SendResult> {
      return metaSendInteractiveList({
        ...creds,
        to: args.to,
        bodyText: args.bodyText,
        buttonLabel: args.buttonLabel,
        headerText: args.headerText,
        footerText: args.footerText,
        sections: args.sections,
        contextMessageId: args.contextMessageId,
      });
    },

    async sendReaction(args: SendReactionArgs): Promise<SendResult> {
      return sendReactionMessage({
        ...creds,
        to: args.to,
        targetMessageId: args.targetMessageId,
        emoji: args.emoji,
      });
    },

    async sendTemplate(args: SendTemplateArgs): Promise<SendResult> {
      return sendTemplateMessage({
        ...creds,
        to: args.to,
        templateName: args.templateName,
        language: args.language,
        template: (args.template as MessageTemplate | undefined) ?? undefined,
        messageParams: (args.messageParams as SendTimeParams | undefined) ?? undefined,
        params: args.params ?? [],
        contextMessageId: args.contextMessageId,
      });
    },

    async resolveInboundMediaUrl(ref: string): Promise<string | null> {
      // A URL direta da Meta expira e exige o token da conta. O proxy
      // resolve sob demanda com a credencial do lado do servidor.
      if (!ref) return null;
      return `/api/whatsapp/media/${ref}`;
    },
  };
}

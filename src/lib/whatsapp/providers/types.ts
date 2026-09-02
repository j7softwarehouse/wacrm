// ============================================================
// Contrato que todo provedor de WhatsApp implementa.
//
// A fronteira fica no nível das *primitivas de envio* — o mesmo
// nível que `meta-api.ts` já expõe. Isso é deliberado: inbox,
// broadcasts, flows, automations e AI auto-reply todos desembocam
// nessas primitivas, então trocá-las por um adapter faz os cinco
// caminhos funcionarem em qualquer provedor sem alteração própria.
// ============================================================

import type {
  InteractiveButton,
  InteractiveListSection,
  MediaKind,
} from "@/lib/whatsapp/meta-api";
import type { WhatsAppProviderKind } from "@/types";

/** Idêntico a `MetaSendResult` — os call sites não mudam de contrato. */
export interface SendResult {
  messageId: string;
}

export class ProviderError extends Error {
  readonly provider: WhatsAppProviderKind;
  constructor(provider: WhatsAppProviderKind, message: string) {
    super(message);
    this.name = "ProviderError";
    this.provider = provider;
  }
}

/**
 * A capacidade não existe neste provedor. Templates aprovados, por
 * exemplo, são exclusivos da Meta. A UI esconde o que não se aplica;
 * este erro é a rede de proteção para um caminho que não deveria ser
 * alcançável.
 */
export class ProviderUnsupportedError extends ProviderError {
  readonly capability: string;
  constructor(provider: WhatsAppProviderKind, capability: string) {
    super(provider, `"${capability}" não é suportado pelo provedor ${provider}.`);
    this.name = "ProviderUnsupportedError";
    this.capability = capability;
  }
}

export interface ProviderRateLimitDetails {
  /** Ex.: "WHATSAPP_REACHOUT_TIMELOCK". */
  errorKey?: string;
  /** Código numérico do provedor upstream. Ex.: 463. */
  providerCode?: number;
  providerMessage?: string;
}

/**
 * O provedor upstream recusou por limite ou qualidade.
 *
 * Importante: quem trata isso num envio em massa deve **parar**, não
 * repetir. Insistir queima a reputação do número e escala para
 * banimento — e número banido é perda permanente.
 */
export class ProviderRateLimitError extends ProviderError {
  readonly errorKey?: string;
  readonly providerCode?: number;
  readonly providerMessage?: string;
  constructor(provider: WhatsAppProviderKind, details: ProviderRateLimitDetails) {
    super(provider, details.providerMessage ?? "Provedor recusou por limite de envio.");
    this.name = "ProviderRateLimitError";
    this.errorKey = details.errorKey;
    this.providerCode = details.providerCode;
    this.providerMessage = details.providerMessage;
  }
}

/** O canal não está conectado; falha antes de sair da aplicação. */
export class ProviderNotConnectedError extends ProviderError {
  readonly channelId: string;
  readonly status: string;
  constructor(provider: WhatsAppProviderKind, channelId: string, status: string) {
    super(provider, `O canal ${channelId} não está conectado (status: ${status}).`);
    this.name = "ProviderNotConnectedError";
    this.channelId = channelId;
    this.status = status;
  }
}

export interface SendTextArgs {
  to: string;
  text: string;
  /** Id (do provedor) da mensagem sendo respondida — gera a citação. */
  contextMessageId?: string;
}

export interface SendMediaArgs {
  to: string;
  kind: MediaKind;
  /** URL pública que o provedor busca no momento do envio. */
  link: string;
  caption?: string;
  /** Só para documentos; é o nome exibido no chat. */
  filename?: string;
  contextMessageId?: string;
}

export interface SendInteractiveButtonsArgs {
  to: string;
  bodyText: string;
  headerText?: string;
  footerText?: string;
  buttons: InteractiveButton[];
  contextMessageId?: string;
}

export interface SendInteractiveListArgs {
  to: string;
  bodyText: string;
  buttonLabel: string;
  headerText?: string;
  footerText?: string;
  sections: InteractiveListSection[];
  contextMessageId?: string;
}

export interface SendReactionArgs {
  to: string;
  targetMessageId: string;
  /** Emoji único, ou string vazia para remover a reação. */
  emoji: string;
}

export interface SendTemplateArgs {
  to: string;
  templateName: string;
  language: string;
  /** Linha local do template (header/botões). Tipada como unknown para
   *  não acoplar o contrato ao schema de templates da Meta. */
  template?: unknown;
  messageParams?: unknown;
  params?: string[];
  contextMessageId?: string;
}

export interface WhatsAppProvider {
  readonly kind: WhatsAppProviderKind;
  sendText(args: SendTextArgs): Promise<SendResult>;
  sendMedia(args: SendMediaArgs): Promise<SendResult>;
  sendInteractiveButtons(args: SendInteractiveButtonsArgs): Promise<SendResult>;
  sendInteractiveList(args: SendInteractiveListArgs): Promise<SendResult>;
  sendReaction(args: SendReactionArgs): Promise<SendResult>;
  sendTemplate(args: SendTemplateArgs): Promise<SendResult>;
  /**
   * Converte a referência de mídia recebida na URL que o CRM guarda.
   * Meta devolve um proxy preguiçoso; UAZAPI baixa para o Storage.
   */
  resolveInboundMediaUrl(ref: string): Promise<string | null>;
  /** Grupos de que o número conectado participa. */
  listGroups(): Promise<Array<{ groupJid: string; name?: string; avatarUrl?: string }>>;
}

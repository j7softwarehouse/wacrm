// ============================================================
// Resolve o provider a partir do canal ou da conversa.
//
// Esta é a peça que faz a segurança funcionar: o adapter volta com
// a credencial já injetada, então nenhum call site volta a manipular
// token. Some o padrão `decrypt(config.access_token)` repetido em
// seis arquivos, e some com ele a chance de um token vazar num log.
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import { decrypt } from "@/lib/whatsapp/encryption";
import type { WhatsAppChannel } from "@/types";

import { createMetaProvider } from "./meta";
import {
  ProviderNotConnectedError,
  ProviderUnsupportedError,
  type WhatsAppProvider,
} from "./types";

export class ChannelNotFoundError extends Error {
  readonly channelId: string;
  constructor(channelId: string) {
    super(`Canal ${channelId} não encontrado.`);
    this.name = "ChannelNotFoundError";
    this.channelId = channelId;
  }
}

export class ConversationHasNoChannelError extends Error {
  readonly conversationId: string;
  constructor(conversationId: string) {
    super(
      `A conversa ${conversationId} não está vinculada a um canal. ` +
        `Isso acontece quando o canal de origem foi removido; a conversa ` +
        `fica como histórico somente-leitura.`,
    );
    this.name = "ConversationHasNoChannelError";
    this.conversationId = conversationId;
  }
}

function buildProvider(channel: WhatsAppChannel): WhatsAppProvider {
  if (channel.status !== "connected") {
    throw new ProviderNotConnectedError(
      channel.provider,
      channel.id,
      channel.status,
    );
  }

  if (channel.provider === "meta") {
    return createMetaProvider({
      phoneNumberId: channel.phone_number_id!,
      accessToken: decrypt(channel.access_token!),
    });
  }

  // O provider UAZAPI entra aqui na Parte B do plano.
  throw new ProviderUnsupportedError(channel.provider, "createProvider");
}

export async function getProviderForChannel(
  db: SupabaseClient,
  channelId: string,
): Promise<WhatsAppProvider> {
  const { data, error } = await db
    .from("whatsapp_channels")
    .select("*")
    .eq("id", channelId)
    .maybeSingle();

  if (error || !data) throw new ChannelNotFoundError(channelId);
  return buildProvider(data as WhatsAppChannel);
}

/**
 * Resolve o provider a partir da conversa — o caminho que a maioria
 * dos call sites usa. `accountId` mantém o escopo de tenancy mesmo
 * quando `db` é o cliente service-role.
 */
export async function getProviderForConversation(
  db: SupabaseClient,
  conversationId: string,
  accountId: string,
): Promise<WhatsAppProvider> {
  const { data, error } = await db
    .from("conversations")
    .select("channel_id")
    .eq("id", conversationId)
    .eq("account_id", accountId)
    .maybeSingle();

  if (error || !data) throw new ChannelNotFoundError(conversationId);
  if (!data.channel_id) throw new ConversationHasNoChannelError(conversationId);

  return getProviderForChannel(db, data.channel_id as string);
}

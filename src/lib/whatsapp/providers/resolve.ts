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
import { createUazapiProvider } from "./uazapi";
import {
  ProviderNotConnectedError,
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

export class NoChannelConfiguredError extends Error {
  readonly accountId: string;
  constructor(accountId: string) {
    super(`Nenhum canal de WhatsApp configurado para a conta ${accountId}.`);
    this.name = "NoChannelConfiguredError";
    this.accountId = accountId;
  }
}

/**
 * The account's oldest channel, or null if it has none. Used wherever
 * a conversation needs a channel_id but the caller only knows the
 * account (outbound-initiated conversations, before Part B's UI lets
 * an operator pick a channel explicitly).
 */
export async function resolveDefaultChannelId(
  db: SupabaseClient,
  accountId: string,
): Promise<string | null> {
  const { data, error } = await db
    .from("whatsapp_channels")
    .select("id")
    .eq("account_id", accountId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return data.id as string;
}

/**
 * Only meaningful for a genuinely channel-restricted caller
 * (`channel_scope = 'assigned'`, and not admin/owner — the two roles
 * that always ignore the restriction). Resolves the oldest channel
 * AMONG the ones this caller attends, or `null` if they haven't been
 * assigned to any yet.
 *
 * Why this exists (2026-09-16): a restricted caller must never fall
 * back to the account's overall oldest channel
 * (`resolveDefaultChannelId`) — if that channel isn't one they attend,
 * the `conversations_insert` policy (`can_start_conversation`) rejects
 * the row outright, and a find-or-create call that was supposed to be
 * transparent (the Contacts "Conversar" button, or
 * `/api/whatsapp/send`'s `contact_id` path) fails with a confusing
 * 500. This is also the COMMON case for a restricted caller: from
 * their own (correctly filtered) `GET /api/whatsapp/channels` list
 * they may see only ONE channel, so the UI never shows an explicit
 * picker for them to choose from.
 *
 * Deliberately does NOT fall through to `resolveDefaultChannelId` for
 * admin/owner/unrestricted callers — callers of this function must
 * only invoke it when `channelScope === 'assigned'` and the caller
 * isn't admin/owner, and pass the result as an EXPLICIT channel id.
 * For every other caller, passing nothing and letting
 * `findOrCreateConversationForContact` resolve its own default
 * internally is required to keep its orphan-healing behaviour (a
 * `channel_id IS NULL` conversation gets adopted into the resolved
 * channel) — pre-resolving and passing it as "explicit" for those
 * callers would silently turn off that healing.
 */
export async function resolveRestrictedFallbackChannelId(
  db: SupabaseClient,
  caller: { userId: string },
): Promise<string | null> {
  const { data: memberRows } = await db
    .from("channel_members")
    .select("channel_id")
    .eq("user_id", caller.userId);
  const allowedIds = (memberRows ?? []).map((r) => r.channel_id as string);
  if (allowedIds.length === 0) return null;

  // Two plain queries + pick the oldest client-side, rather than
  // relying on PostgREST's order-by-embedded-relation syntax for a
  // one-off lookup.
  const { data: allowedChannels } = await db
    .from("whatsapp_channels")
    .select("id, created_at")
    .in("id", allowedIds)
    .order("created_at", { ascending: true })
    .limit(1);
  return (allowedChannels?.[0]?.id as string) ?? null;
}

function buildProvider(channel: WhatsAppChannel): WhatsAppProvider {
  // UAZAPI's `connected` reflects a live session; sending genuinely
  // requires it. Meta's `status` (migração 015) is registration/webhook
  // metadata, never a precondition for the Graph API accepting a send —
  // gating Meta on it would be a real behavior change from the
  // pre-multi-canal code, which only required a valid token.
  if (channel.provider === "uazapi" && channel.status !== "connected") {
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
  } else {
    return createUazapiProvider({
      baseUrl: channel.uazapi_base_url!,
      token: decrypt(channel.uazapi_token!),
      accountId: channel.account_id,
    });
  }
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

  let channelId = data.channel_id as string | null;

  if (!channelId) {
    // Conversations created before this conversation had a channel_id
    // backfilled (migration 037), or created by a call site that
    // doesn't set it explicitly (dashboard/public-API sends), fall back
    // to the account's channel — the same "one config per account"
    // resolution the pre-multi-canal code always used. Shared with the
    // outbound conversation creators via `resolveDefaultChannelId`, so
    // "the account's default channel" has exactly one definition.
    const fallbackChannelId = await resolveDefaultChannelId(db, accountId);
    if (!fallbackChannelId) {
      throw new NoChannelConfiguredError(accountId);
    }
    channelId = fallbackChannelId;
  }

  return getProviderForChannel(db, channelId);
}

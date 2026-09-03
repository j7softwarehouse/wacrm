import type { Conversation, Contact, Tag } from "@/types";
import type { PublicChannel } from "@/app/api/whatsapp/channels/route";

/**
 * Conversation select that embeds the contact plus its tags, so the Inbox
 * can filter conversations by contact tag without a second round-trip.
 * `contact_tags(tags(*))` returns the join rows; {@link normalizeConversation}
 * flattens them onto `contact.tags`.
 *
 * Also embeds the group (columns `id`, `name`, `avatar_url` from
 * `whatsapp_groups`, migration 20260829000001) for the group-conversation
 * path: `group_id` is set instead of `contact_id`, so without this join
 * every group conversation showed up in the Inbox list as "Desconhecido"
 * (no `contact` to read a name from). Found during the Task 12
 * end-to-end verification against a real database.
 */
export const CONVERSATION_SELECT =
  "*, contact:contacts(*, contact_tags(tags(*))), group:whatsapp_groups(id, name, avatar_url)";

/** Raw shape returned by {@link CONVERSATION_SELECT} before flattening. */
type RawContact = Contact & { contact_tags?: { tags: Tag | null }[] };
type RawConversation = Omit<Conversation, "contact"> & {
  contact?: RawContact | null;
};

/**
 * Flatten the embedded `contact_tags(tags(*))` join into `contact.tags`.
 * Safe to call on rows fetched with {@link CONVERSATION_SELECT}; a row with
 * no contact (e.g. a freshly-inserted conversation) passes through untouched.
 */
export function normalizeConversation(raw: RawConversation): Conversation {
  const rawContact = raw.contact;
  if (!rawContact) return raw as Conversation;

  const { contact_tags, ...contact } = rawContact;
  return {
    ...raw,
    contact: {
      ...contact,
      tags: (contact_tags ?? [])
        .map((ct) => ct.tags)
        .filter((t): t is Tag => t != null),
    },
  };
}

export function normalizeConversations(
  rows: RawConversation[],
): Conversation[] {
  return rows.map(normalizeConversation);
}

export interface ContactFilters {
  /** Tag ids; a conversation matches if its contact has ANY of them (OR). */
  tagIds: string[];
  /** Exact company match, or null for no company filter. */
  company: string | null;
}

/**
 * Best available display name for a conversation, or `null` when there's
 * nothing to show (caller falls back to an "unknown" label). A group
 * conversation has `group` but no `contact` (`contact_id` is null for it,
 * per `conversations_contact_xor_group`); the 1:1 path is the mirror
 * image. Checking `group` first costs nothing on the 1:1 path (it's
 * always undefined there) and gives the group path priority when, in
 * theory, both were present.
 */
export function conversationDisplayName(conversation: {
  group?: Conversation["group"];
  contact?: Contact | null;
}): string | null {
  return (
    conversation.group?.name ||
    conversation.contact?.name ||
    conversation.contact?.phone ||
    null
  );
}

/**
 * Whether a conversation passes the contact-based Inbox filters (issue #272).
 * Empty `tagIds` and null `company` are no-ops, so the default (no filters)
 * always matches. Tags use OR logic, consistent with Broadcast audiences.
 */
export function matchesContactFilters(
  conversation: Conversation,
  { tagIds, company }: ContactFilters,
): boolean {
  if (tagIds.length > 0) {
    const contactTagIds = conversation.contact?.tags ?? [];
    if (!contactTagIds.some((t) => tagIds.includes(t.id))) return false;
  }

  if (company !== null && conversation.contact?.company?.trim() !== company) {
    return false;
  }

  return true;
}

/**
 * Display label for a WhatsApp channel: its custom `label` when set,
 * otherwise the phone number. Returns `undefined` when neither is
 * available (e.g. a UAZAPI channel that's never connected), which
 * callers should treat as "nothing to show" rather than rendering an
 * empty chip.
 */
export function channelLabel(
  channel: Pick<PublicChannel, "label" | "phone_e164">,
): string | undefined {
  return channel.label || channel.phone_e164 || undefined;
}

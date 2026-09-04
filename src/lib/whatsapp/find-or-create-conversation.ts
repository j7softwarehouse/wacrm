import type { createClient } from '@/lib/supabase/server'
import { resolveDefaultChannelId } from '@/lib/whatsapp/providers/resolve'

type FindOrCreateSupabase = Awaited<ReturnType<typeof createClient>>

/**
 * Return the contact's conversation id in this account, creating one if
 * it doesn't exist yet. Mirrors the webhook's find-or-create so an
 * inbound-then-outbound (or outbound-first) sequence converges on a single
 * thread per contact. Runs under the caller's RLS — the conversations_insert
 * policy requires account agent membership, which the caller already is.
 *
 * Shared by every UI path that opens a thread from a contact instead of an
 * existing conversation: the dashboard send route's `contact_id` path and
 * the Contacts "Conversar" button, which opens (or creates) the thread
 * without sending anything.
 *
 * Channel binding (migração 037): conversations are scoped by
 * `(account_id, contact_id, channel_id)`. This call site only knows the
 * account — the dashboard has no channel picker until Part B — so it
 * resolves the account's default channel and:
 *
 *   - matches EITHER that channel or a NULL `channel_id`, so a thread
 *     the inbound webhook already opened under the real channel is
 *     found instead of being duplicated;
 *   - backfills a NULL `channel_id` hit, so a legacy/orphan row is
 *     healed on first touch instead of lingering as a second slot that
 *     the strictly channel-scoped inbound lookup can never reach.
 *
 * Without this, an outbound-first conversation (channel_id NULL) and the
 * inbound webhook's channel-scoped lookup fork into two threads, and the
 * next send's `.maybeSingle()` errors on two rows → insert → unique
 * violation on the NULL slot → permanent 500 for that contact.
 */
export async function findOrCreateConversationForContact(
  supabase: FindOrCreateSupabase,
  accountId: string,
  userId: string,
  contactId: string,
): Promise<string | null> {
  // May legitimately be null (account has no channel at all). The send
  // itself fails later with a clear "not configured" error; we still
  // want the find-or-create to behave sanely in the meantime.
  const channelId = await resolveDefaultChannelId(supabase, accountId)

  // Ordered oldest-first + `.limit(1)` rather than `.maybeSingle()`:
  // maybeSingle errors on ≥2 rows, and the old code treated that error
  // as "not found" and inserted yet another row (issue #363's shape).
  let query = supabase
    .from('conversations')
    .select('id, channel_id')
    .eq('account_id', accountId)
    .eq('contact_id', contactId)
  // `channelId` is a UUID this function just read from our own
  // `whatsapp_channels` table — never caller-supplied text — so
  // interpolating it into PostgREST's `or` filter grammar is safe.
  if (channelId) {
    query = query.or(`channel_id.eq.${channelId},channel_id.is.null`)
  }
  const { data: existingRows, error: findError } = await query
    .order('created_at', { ascending: true })
    .limit(1)

  if (findError) {
    console.error('Error finding conversation for contact send:', findError.message)
    return null
  }

  if (existingRows && existingRows.length > 0) {
    const found = existingRows[0]
    if (channelId && !found.channel_id) {
      // Heal the orphan. `.is('channel_id', null)` makes this a no-op if
      // a concurrent writer already claimed it.
      await supabase
        .from('conversations')
        .update({ channel_id: channelId })
        .eq('id', found.id)
        .is('channel_id', null)
    }
    return found.id
  }

  const { data: created, error } = await supabase
    .from('conversations')
    .insert({
      account_id: accountId,
      user_id: userId,
      contact_id: contactId,
      channel_id: channelId,
    })
    .select('id')
    .single()

  if (error) {
    console.error('Error creating conversation for contact send:', error.message)
    return null
  }

  return created.id
}

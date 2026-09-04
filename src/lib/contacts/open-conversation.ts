/** Find-or-create the contact's conversation and return its id, without
 *  sending a message. Backs the "Conversar" button in the Contacts list
 *  and detail view — the caller navigates to `/inbox?c=<id>` afterwards. */
export async function openConversationForContact(contactId: string): Promise<string> {
  const res = await fetch('/api/whatsapp/conversations/open', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contact_id: contactId }),
  })

  const payload = await res.json().catch(() => ({}))
  if (!res.ok || !payload?.conversation_id) {
    throw new Error(payload?.error || `HTTP ${res.status}`)
  }

  return payload.conversation_id as string
}

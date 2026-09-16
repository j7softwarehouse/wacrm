/** Find-or-create the group's conversation and return its id, without
 *  sending a message. Backs the "Conversar" button in Settings → Grupos —
 *  mirra `openConversationForContact`. The caller navigates to
 *  `/inbox?c=<id>` afterwards. */
export async function openConversationForGroup(groupId: string): Promise<string> {
  const res = await fetch(`/api/whatsapp/groups/${groupId}/open`, {
    method: 'POST',
  });

  const payload = await res.json().catch(() => ({}));
  if (!res.ok || !payload?.conversation_id) {
    throw new Error(payload?.error || `HTTP ${res.status}`);
  }

  return payload.conversation_id as string;
}

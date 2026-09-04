import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit'
import { findOrCreateConversationForContact } from '@/lib/whatsapp/find-or-create-conversation'

// Backs the Contacts "Conversar" button: find-or-create the contact's
// conversation and hand back its id so the UI can jump straight to
// `/inbox?c=<id>` — no message is sent here. Unlike `/api/whatsapp/send`'s
// `contact_id` path (which requires an approved template on Meta channels),
// this route never sends anything, so it works the same regardless of
// channel provider — the Inbox composer decides afterwards whether the
// contact needs a template (Meta) or can just get a free-form text
// (uazapi).
export async function POST(request: Request) {
  try {
    const supabase = await createClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const limit = checkRateLimit(`open-conversation:${user.id}`, RATE_LIMITS.send)
    if (!limit.success) {
      return rateLimitResponse(limit)
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('account_id')
      .eq('user_id', user.id)
      .maybeSingle()
    const accountId = profile?.account_id as string | undefined
    if (!accountId) {
      return NextResponse.json(
        { error: 'Your profile is not linked to an account.' },
        { status: 403 },
      )
    }

    const { contact_id } = await request.json()
    if (!contact_id) {
      return NextResponse.json({ error: 'contact_id is required' }, { status: 400 })
    }

    const { data: contactRow, error: contactErr } = await supabase
      .from('contacts')
      .select('id')
      .eq('id', contact_id)
      .eq('account_id', accountId)
      .maybeSingle()

    if (contactErr || !contactRow) {
      return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
    }

    const conversationId = await findOrCreateConversationForContact(
      supabase,
      accountId,
      user.id,
      contact_id,
    )
    if (!conversationId) {
      return NextResponse.json(
        { error: 'Failed to open a conversation for this contact' },
        { status: 500 },
      )
    }

    return NextResponse.json({ conversation_id: conversationId })
  } catch (error) {
    console.error('Error in WhatsApp conversations/open POST:', error)
    return NextResponse.json({ error: 'Failed to open conversation' }, { status: 500 })
  }
}

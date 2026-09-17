import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit'
import { findOrCreateConversationForContact } from '@/lib/whatsapp/find-or-create-conversation'
import { resolveRestrictedFallbackChannelId } from '@/lib/whatsapp/providers/resolve'
import { isConversationScope } from '@/lib/auth/conversation-scope'
import { isAccountRole } from '@/lib/auth/roles'

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
      .select('account_id, account_role, channel_scope')
      .eq('user_id', user.id)
      .maybeSingle()
    const accountId = profile?.account_id as string | undefined
    if (!accountId) {
      return NextResponse.json(
        { error: 'Your profile is not linked to an account.' },
        { status: 403 },
      )
    }

    const { contact_id, channel_id } = await request.json()
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

    // channel_id vem do seletor de canal em Contatos (quando a conta tem
    // 2+ canais). Confirma que pertence à mesma conta antes de repassar —
    // senão um id forjado/de outra conta escolheria canal alheio.
    let explicitChannelId: string | undefined
    if (channel_id) {
      const { data: channelRow } = await supabase
        .from('whatsapp_channels')
        .select('id')
        .eq('id', channel_id)
        .eq('account_id', accountId)
        .maybeSingle()
      if (!channelRow) {
        return NextResponse.json({ error: 'Invalid channel_id' }, { status: 400 })
      }
      explicitChannelId = channel_id
    }

    // Sem canal explícito E o chamador é realmente restrito por canal:
    // resolve pro canal mais antigo DENTRE os que ele atende, nunca o
    // mais antigo DA CONTA (a política de INSERT recusaria a linha se
    // não for um canal que ele atende) — isso também cobre o caso
    // comum de o restrito enxergar só 1 canal (o dele) e o seletor da
    // tela nem aparecer pra escolher explicitamente. Quem NÃO é
    // restrito continua sem canal explícito aqui de propósito: deixa
    // `findOrCreateConversationForContact` resolver e curar conversa
    // órfã internamente, como sempre fez. Ver
    // docs/superpowers/specs/2026-09-16-restricao-por-canal-design.md §6.
    if (!explicitChannelId) {
      const role = isAccountRole(profile?.account_role) ? profile.account_role : 'viewer'
      const channelScope = isConversationScope(profile?.channel_scope)
        ? profile.channel_scope
        : 'all'
      if (role !== 'admin' && role !== 'owner' && channelScope === 'assigned') {
        const fallbackChannelId = await resolveRestrictedFallbackChannelId(supabase, {
          userId: user.id,
        })
        if (!fallbackChannelId) {
          return NextResponse.json(
            { error: 'You have not been assigned to any channel yet.' },
            { status: 403 },
          )
        }
        explicitChannelId = fallbackChannelId
      }
    }

    const conversationId = await findOrCreateConversationForContact(
      supabase,
      accountId,
      user.id,
      contact_id,
      explicitChannelId,
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

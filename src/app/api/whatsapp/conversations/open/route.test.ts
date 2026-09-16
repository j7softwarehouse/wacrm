import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Tests for the Contacts "Conversar" button's backing route: find-or-create
// the contact's conversation WITHOUT sending anything, so the UI can jump
// straight to /inbox?c=<id> and let the user type a free-form message —
// mirroring the contact_id path in /api/whatsapp/send, minus the send.
// ---------------------------------------------------------------------------

const conversationInserts: Array<Record<string, unknown>> = []

let existingConversation: Record<string, unknown> | null = null
let contactRow: Record<string, unknown> | null = null
let createdConversation: Record<string, unknown> | null = null
// Canal "de verdade" pertencente à conta, usado pela checagem de posse de
// `channel_id` explícito na rota. `null` simula um id que não pertence a
// esta conta (forjado ou de outra conta).
let ownedChannel: Record<string, unknown> | null = { id: 'chan-2' }

const CONTACT = {
  id: 'contact-1',
  account_id: 'acct-1',
  phone: '+15551234567',
}

function makeSupabaseMock() {
  function builder(table: string) {
    let didInsert = false
    const eqCalls: Array<[string, unknown]> = []

    const selectResult = () => {
      switch (table) {
        case 'profiles':
          return { data: { account_id: 'acct-1' }, error: null }
        case 'contacts':
          return { data: contactRow, error: null }
        case 'conversations':
          return { data: createdConversation ?? existingConversation, error: null }
        case 'whatsapp_channels': {
          const idFilter = eqCalls.find(([col]) => col === 'id')
          if (idFilter) {
            const [, id] = idFilter
            return { data: ownedChannel && ownedChannel.id === id ? ownedChannel : null, error: null }
          }
          return { data: { id: 'chan-1' }, error: null }
        }
        default:
          return { data: null, error: null }
      }
    }

    const insertResult = () => {
      switch (table) {
        case 'conversations':
          return { data: createdConversation ?? existingConversation, error: null }
        default:
          return { data: null, error: null }
      }
    }

    const terminal = () =>
      Promise.resolve(didInsert ? insertResult() : selectResult())

    const listTerminal = () => {
      const r = didInsert ? insertResult() : selectResult()
      if (r.error) return r
      const d = r.data
      return { data: d == null ? [] : Array.isArray(d) ? d : [d], error: null }
    }

    const b: Record<string, unknown> = {}
    const chain = () => b
    for (const m of ['select', 'in', 'or', 'is', 'order', 'limit', 'update']) {
      b[m] = vi.fn(chain)
    }
    b.eq = vi.fn((col: string, val: unknown) => {
      eqCalls.push([col, val])
      return b
    })
    b.insert = vi.fn((payload: Record<string, unknown>) => {
      didInsert = true
      if (table === 'conversations') {
        conversationInserts.push(payload)
        createdConversation = {
          id: 'conv-new',
          account_id: 'acct-1',
          contact_id: 'contact-1',
        }
      }
      return b
    })
    b.single = vi.fn(terminal)
    b.maybeSingle = vi.fn(terminal)
    b.then = (resolve: (v: unknown) => unknown) => resolve(listTerminal())
    return b
  }

  return {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: 'user-1' } },
        error: null,
      })),
    },
    from: vi.fn((table: string) => builder(table)),
  }
}

let supabaseMock = makeSupabaseMock()

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => supabaseMock),
}))

import { POST } from './route'

function postOpen(overrides: Record<string, unknown> = {}) {
  return POST(
    new Request('http://localhost/api/whatsapp/conversations/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contact_id: 'contact-1', ...overrides }),
    }),
  )
}

describe('POST /api/whatsapp/conversations/open', () => {
  beforeEach(() => {
    conversationInserts.length = 0
    existingConversation = null
    createdConversation = null
    contactRow = CONTACT
    ownedChannel = { id: 'chan-2' }
    supabaseMock = makeSupabaseMock()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('creates a conversation for a contact with none, without sending a message', async () => {
    const res = await postOpen()
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.conversation_id).toBe('conv-new')
    expect(conversationInserts).toHaveLength(1)
    expect(conversationInserts[0]).toMatchObject({
      account_id: 'acct-1',
      contact_id: 'contact-1',
      channel_id: 'chan-1',
    })
  })

  it('reuses an existing conversation instead of creating a duplicate', async () => {
    existingConversation = {
      id: 'conv-existing',
      account_id: 'acct-1',
      contact_id: 'contact-1',
    }

    const res = await postOpen()
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.conversation_id).toBe('conv-existing')
    expect(conversationInserts).toHaveLength(0)
  })

  it('404s when the contact is not in the caller account', async () => {
    contactRow = null

    const res = await postOpen()
    const json = await res.json()

    expect(res.status).toBe(404)
    expect(json.error).toMatch(/contact not found/i)
  })

  it('400s when contact_id is missing', async () => {
    const res = await POST(
      new Request('http://localhost/api/whatsapp/conversations/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
    )
    expect(res.status).toBe(400)
  })

  it('uses an explicit channel_id that belongs to the account, instead of the default channel', async () => {
    ownedChannel = { id: 'chan-2' }

    const res = await postOpen({ channel_id: 'chan-2' })
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.conversation_id).toBe('conv-new')
    expect(conversationInserts).toHaveLength(1)
    expect(conversationInserts[0]).toMatchObject({
      account_id: 'acct-1',
      contact_id: 'contact-1',
      channel_id: 'chan-2',
    })
  })

  it('400s when channel_id does not belong to the caller account', async () => {
    ownedChannel = null // simula id forjado ou de outra conta

    const res = await postOpen({ channel_id: 'chan-alheio' })
    const json = await res.json()

    expect(res.status).toBe(400)
    expect(json.error).toMatch(/channel/i)
    expect(conversationInserts).toHaveLength(0)
  })

  it('falls back to the default channel when channel_id is not provided', async () => {
    const res = await postOpen()
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.conversation_id).toBe('conv-new')
    expect(conversationInserts[0]).toMatchObject({ channel_id: 'chan-1' })
  })
})

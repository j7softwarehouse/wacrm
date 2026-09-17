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
// Perfil do chamador -- configurável por teste pra exercitar o fallback
// de canal restrito (ver docs/superpowers/specs/2026-09-16-restricao-por-canal-design.md §6).
let callerProfile: Record<string, unknown> = { account_id: 'acct-1' }
// Canais que o chamador atende, quando `channel_scope` é 'assigned'.
let memberChannelIds: string[] = []
// Metadados (id + created_at) dos canais consultados pelo fallback
// restrito, pra decidir qual é "o mais antigo dentre os permitidos".
let channelsMeta: Record<string, unknown>[] = []

const CONTACT = {
  id: 'contact-1',
  account_id: 'acct-1',
  phone: '+15551234567',
}

function makeSupabaseMock() {
  function builder(table: string) {
    let didInsert = false
    const eqCalls: Array<[string, unknown]> = []
    const inCalls: Array<[string, unknown[]]> = []

    const selectResult = () => {
      switch (table) {
        case 'profiles':
          return { data: callerProfile, error: null }
        case 'contacts':
          return { data: contactRow, error: null }
        case 'conversations':
          return { data: createdConversation ?? existingConversation, error: null }
        case 'channel_members':
          return {
            data: memberChannelIds.map((id) => ({ channel_id: id })),
            error: null,
          }
        case 'whatsapp_channels': {
          const idFilter = eqCalls.find(([col]) => col === 'id')
          if (idFilter) {
            const [, id] = idFilter
            return { data: ownedChannel && ownedChannel.id === id ? ownedChannel : null, error: null }
          }
          const inFilter = inCalls.find(([col]) => col === 'id')
          if (inFilter) {
            const [, ids] = inFilter
            const matched = channelsMeta
              .filter((c) => ids.includes(c.id as string))
              .sort(
                (a, b) =>
                  new Date(a.created_at as string).getTime() -
                  new Date(b.created_at as string).getTime(),
              )
            return { data: matched, error: null }
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
    for (const m of ['select', 'or', 'is', 'order', 'limit', 'update']) {
      b[m] = vi.fn(chain)
    }
    b.eq = vi.fn((col: string, val: unknown) => {
      eqCalls.push([col, val])
      return b
    })
    b.in = vi.fn((col: string, vals: unknown[]) => {
      inCalls.push([col, vals])
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
    callerProfile = { account_id: 'acct-1' }
    memberChannelIds = []
    channelsMeta = []
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

  // ---------------------------------------------------------------------
  // Escopo de canal (2026-09-16) -- sem channel_id explícito, um chamador
  // restrito por canal NÃO pode cair no canal mais antigo DA CONTA
  // (resolveDefaultChannelId): se não for um dos canais que ele atende, a
  // política de INSERT recusa a linha e o botão "Conversar" falhava com
  // 500. Isso também é o caminho comum de quem só enxerga 1 canal (o
  // dele) e nunca vê o seletor pra escolher explicitamente.
  // ---------------------------------------------------------------------

  it('restrito por canal: usa o mais antigo DENTRE os canais que atende, não o mais antigo da conta', async () => {
    callerProfile = { account_id: 'acct-1', account_role: 'agent', channel_scope: 'assigned' }
    memberChannelIds = ['chan-9']
    channelsMeta = [
      { id: 'chan-1', created_at: '2026-01-01T00:00:00Z' }, // o mais antigo DA CONTA
      { id: 'chan-9', created_at: '2026-06-01T00:00:00Z' }, // o único que ele atende
    ]

    const res = await postOpen()
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.conversation_id).toBe('conv-new')
    expect(conversationInserts[0]).toMatchObject({ channel_id: 'chan-9' })
  })

  it('restrito por canal sem nenhum canal atribuído: 403, não tenta criar nada', async () => {
    callerProfile = { account_id: 'acct-1', account_role: 'agent', channel_scope: 'assigned' }
    memberChannelIds = []

    const res = await postOpen()
    const json = await res.json()

    expect(res.status).toBe(403)
    expect(json.error).toMatch(/channel/i)
    expect(conversationInserts).toHaveLength(0)
  })

  it('admin com channel_scope marcado "assigned" ainda assim usa o canal mais antigo da conta (ignora o escopo)', async () => {
    callerProfile = { account_id: 'acct-1', account_role: 'admin', channel_scope: 'assigned' }
    memberChannelIds = ['chan-9']
    channelsMeta = [{ id: 'chan-9', created_at: '2026-06-01T00:00:00Z' }]

    const res = await postOpen()

    expect(res.status).toBe(200)
    expect(conversationInserts[0]).toMatchObject({ channel_id: 'chan-1' })
  })

  it('channel_scope "all": usa o canal mais antigo da conta normalmente, sem consultar channel_members', async () => {
    callerProfile = { account_id: 'acct-1', account_role: 'agent', channel_scope: 'all' }

    const res = await postOpen()

    expect(res.status).toBe(200)
    expect(conversationInserts[0]).toMatchObject({ channel_id: 'chan-1' })
  })

  it('channel_id explícito continua tendo prioridade mesmo pra quem é restrito por canal', async () => {
    callerProfile = { account_id: 'acct-1', account_role: 'agent', channel_scope: 'assigned' }
    memberChannelIds = ['chan-2']
    ownedChannel = { id: 'chan-2' }

    const res = await postOpen({ channel_id: 'chan-2' })

    expect(res.status).toBe(200)
    expect(conversationInserts[0]).toMatchObject({ channel_id: 'chan-2' })
  })
})

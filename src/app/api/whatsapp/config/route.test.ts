import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ createClient: vi.fn() }))

vi.mock('@/lib/supabase/server', () => ({
  createClient: mocks.createClient,
}))

import { GET } from './route'

function makeSupabase(profile: { account_id: string; account_role: string } | null) {
  return {
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: 'user-1' } }, error: null })),
    },
    from: (table: string) => {
      if (table === 'profiles') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: profile, error: null }),
            }),
          }),
        }
      }
      // whatsapp_channels — so alcancado se a checagem de papel deixar passar.
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: async () => ({ data: null, error: null }),
                }),
              }),
            }),
          }),
        }),
      }
    },
  }
}

describe('GET /api/whatsapp/config', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('recusa agent com 403, sem consultar whatsapp_channels', async () => {
    mocks.createClient.mockResolvedValue(
      makeSupabase({ account_id: 'acct-1', account_role: 'agent' }),
    )

    const res = await GET()
    const json = await res.json()

    expect(res.status).toBe(403)
    expect(json.error).toMatch(/admin/i)
  })

  it('recusa viewer com 403', async () => {
    mocks.createClient.mockResolvedValue(
      makeSupabase({ account_id: 'acct-1', account_role: 'viewer' }),
    )

    const res = await GET()

    expect(res.status).toBe(403)
  })

  it('deixa admin passar (chega na resposta de "sem config", nao no 403)', async () => {
    mocks.createClient.mockResolvedValue(
      makeSupabase({ account_id: 'acct-1', account_role: 'admin' }),
    )

    const res = await GET()
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.reason).toBe('no_config')
  })
})

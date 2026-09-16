import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ForbiddenError } from '@/lib/auth/account'

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  decrypt: vi.fn(),
  uazapiGet: vi.fn(),
  registerUazapiWebhook: vi.fn(),
}))

vi.mock('@/lib/auth/account', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/account')>()
  return { ...actual, requireRole: mocks.requireRole }
})

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: mocks.decrypt,
}))

vi.mock('@/lib/whatsapp/uazapi/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/whatsapp/uazapi/client')>()
  return {
    ...actual,
    createUazapiClient: () => ({ get: mocks.uazapiGet, post: vi.fn() }),
  }
})

vi.mock('@/lib/whatsapp/uazapi/register-webhook', () => ({
  registerUazapiWebhook: mocks.registerUazapiWebhook,
}))

import { GET } from './route'

function request() {
  return new Request('http://localhost/api/whatsapp/channels/chan-1/status')
}

describe('GET /api/whatsapp/channels/[id]/status', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.decrypt.mockReturnValue('token-plano')
    mocks.uazapiGet.mockResolvedValue({ instance: { status: 'connecting' }, status: {} })
  })

  it('exige o papel admin — nao so pertencer a conta', async () => {
    mocks.requireRole.mockRejectedValue(
      new ForbiddenError("This action requires the 'admin' role or higher"),
    )

    const res = await GET(request(), { params: Promise.resolve({ id: 'chan-1' }) })

    expect(res.status).toBe(403)
    expect(mocks.requireRole).toHaveBeenCalledWith('admin')
  })

  it('deixa admin passar do gate (nao e barrado, chega no proxy da uazapi)', async () => {
    mocks.requireRole.mockResolvedValue({
      supabase: {
        from: () => ({
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    id: 'chan-1',
                    uazapi_base_url: 'https://x.uazapi.com',
                    uazapi_token: 'ciphertext',
                    status: 'connecting',
                    webhook_registered_at: '2026-01-01T00:00:00Z',
                  },
                  error: null,
                }),
              }),
            }),
          }),
          update: () => ({ eq: async () => ({ error: null }) }),
        }),
      },
      accountId: 'acct-1',
    })

    const res = await GET(request(), { params: Promise.resolve({ id: 'chan-1' }) })

    expect(res.status).not.toBe(403)
    expect(mocks.requireRole).toHaveBeenCalledWith('admin')
  })
})

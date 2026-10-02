import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ForbiddenError } from '@/lib/auth/account'

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  decrypt: vi.fn(),
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
    createUazapiClient: () => ({ get: vi.fn(), post: vi.fn() }),
  }
})

vi.mock('@/lib/whatsapp/uazapi/register-webhook', () => ({
  registerUazapiWebhook: mocks.registerUazapiWebhook,
}))

import { POST } from './route'

function request() {
  return new Request('http://localhost/api/whatsapp/channels/chan-1/resync-webhook', {
    method: 'POST',
  })
}

const CHANNEL_JA_REGISTRADO = {
  id: 'chan-1',
  provider: 'uazapi',
  uazapi_base_url: 'https://x.uazapi.com',
  uazapi_token: 'ciphertext',
  // Carimbado há tempos — é EXATAMENTE o caso que /status e /connect
  // ignoram (só registram quando este campo é nulo). Esta rota existe
  // pra reenviar MESMO assim.
  webhook_registered_at: '2026-01-01T00:00:00Z',
}

function comChannel(channel: Record<string, unknown> | null) {
  return {
    supabase: {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: channel, error: null }),
            }),
          }),
        }),
      }),
    },
    accountId: 'acct-1',
  }
}

describe('POST /api/whatsapp/channels/[id]/resync-webhook', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.decrypt.mockReturnValue('token-plano')
  })

  it('exige o papel admin', async () => {
    mocks.requireRole.mockRejectedValue(
      new ForbiddenError("This action requires the 'admin' role or higher"),
    )

    const res = await POST(request(), { params: Promise.resolve({ id: 'chan-1' }) })

    expect(res.status).toBe(403)
    expect(mocks.requireRole).toHaveBeenCalledWith('admin')
  })

  it('devolve 404 quando o canal não existe (ou é de outra conta)', async () => {
    mocks.requireRole.mockResolvedValue(comChannel(null))

    const res = await POST(request(), { params: Promise.resolve({ id: 'chan-1' }) })

    expect(res.status).toBe(404)
    expect(mocks.registerUazapiWebhook).not.toHaveBeenCalled()
  })

  it('devolve 400 pra canal Meta (webhook UAZAPI não se aplica)', async () => {
    mocks.requireRole.mockResolvedValue(
      comChannel({ ...CHANNEL_JA_REGISTRADO, provider: 'meta' }),
    )

    const res = await POST(request(), { params: Promise.resolve({ id: 'chan-1' }) })

    expect(res.status).toBe(400)
    expect(mocks.registerUazapiWebhook).not.toHaveBeenCalled()
  })

  it('reenvia MESMO com webhook_registered_at já preenchido — é o propósito da rota', async () => {
    mocks.requireRole.mockResolvedValue(comChannel(CHANNEL_JA_REGISTRADO))
    mocks.registerUazapiWebhook.mockResolvedValue(true)

    const res = await POST(request(), { params: Promise.resolve({ id: 'chan-1' }) })
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.success).toBe(true)
    expect(mocks.registerUazapiWebhook).toHaveBeenCalledTimes(1)
  })

  it('devolve 502 quando o registro falha', async () => {
    mocks.requireRole.mockResolvedValue(comChannel(CHANNEL_JA_REGISTRADO))
    mocks.registerUazapiWebhook.mockResolvedValue(false)

    const res = await POST(request(), { params: Promise.resolve({ id: 'chan-1' }) })

    expect(res.status).toBe(502)
  })
})

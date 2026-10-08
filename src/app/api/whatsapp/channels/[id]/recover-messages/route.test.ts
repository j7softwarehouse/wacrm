import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ForbiddenError } from '@/lib/auth/account'

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  decrypt: vi.fn(),
  recoverMessages: vi.fn(),
  getProviderForChannel: vi.fn(),
  supabaseAdmin: vi.fn(),
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

vi.mock('@/lib/whatsapp/uazapi/recovery', () => ({
  recoverMessages: mocks.recoverMessages,
}))

vi.mock('@/lib/whatsapp/providers/resolve', () => ({
  getProviderForChannel: mocks.getProviderForChannel,
}))

vi.mock('@/lib/flows/admin-client', () => ({
  supabaseAdmin: mocks.supabaseAdmin,
}))

import { POST } from './route'

const CHANNEL = {
  id: 'chan-1',
  provider: 'uazapi',
  uazapi_base_url: 'https://x.uazapi.com',
  uazapi_token: 'ciphertext',
}

function request(body: unknown) {
  return new Request('http://localhost/api/whatsapp/channels/chan-1/recover-messages', {
    method: 'POST',
    body: JSON.stringify(body),
  })
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

const VALID_BODY = { sinceIso: '2026-10-07T12:00:00Z', untilIso: '2026-10-07T16:00:00Z' }

describe('POST /api/whatsapp/channels/[id]/recover-messages', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.decrypt.mockReturnValue('token-plano')
    mocks.getProviderForChannel.mockResolvedValue({ resolveInboundMediaUrl: vi.fn() })
    mocks.supabaseAdmin.mockReturnValue({ from: vi.fn() })
  })

  it('exige o papel admin', async () => {
    mocks.requireRole.mockRejectedValue(
      new ForbiddenError("This action requires the 'admin' role or higher"),
    )

    const res = await POST(request(VALID_BODY), { params: Promise.resolve({ id: 'chan-1' }) })

    expect(res.status).toBe(403)
    expect(mocks.recoverMessages).not.toHaveBeenCalled()
  })

  it('devolve 400 quando falta sinceIso/untilIso', async () => {
    mocks.requireRole.mockResolvedValue(comChannel(CHANNEL))

    const res = await POST(request({ sinceIso: '2026-10-07T12:00:00Z' }), {
      params: Promise.resolve({ id: 'chan-1' }),
    })

    expect(res.status).toBe(400)
    expect(mocks.recoverMessages).not.toHaveBeenCalled()
  })

  it('devolve 404 quando o canal não existe (ou é de outra conta)', async () => {
    mocks.requireRole.mockResolvedValue(comChannel(null))

    const res = await POST(request(VALID_BODY), { params: Promise.resolve({ id: 'chan-1' }) })

    expect(res.status).toBe(404)
  })

  it('devolve 400 pra canal Meta', async () => {
    mocks.requireRole.mockResolvedValue(comChannel({ ...CHANNEL, provider: 'meta' }))

    const res = await POST(request(VALID_BODY), { params: Promise.resolve({ id: 'chan-1' }) })

    expect(res.status).toBe(400)
  })

  it('200: chama recoverMessages com suppressEngines embutido e devolve o resumo', async () => {
    mocks.requireRole.mockResolvedValue(comChannel(CHANNEL))
    mocks.recoverMessages.mockResolvedValue({
      chatsScanned: 3,
      truncated: false,
      inserted: 2,
      alreadyExisted: 1,
      skippedUnparseable: 0,
      errors: 0,
      outcomes: [
        { providerMessageId: 'MSG1', chatid: 'a@s.whatsapp.net', status: 'inserted' },
        { providerMessageId: 'MSG2', chatid: 'a@s.whatsapp.net', status: 'inserted' },
        { providerMessageId: 'MSG3', chatid: 'a@s.whatsapp.net', status: 'already_existed' },
      ],
    })

    const res = await POST(request(VALID_BODY), { params: Promise.resolve({ id: 'chan-1' }) })
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.inserted).toBe(2)
    expect(json.alreadyExisted).toBe(1)
    expect(mocks.recoverMessages).toHaveBeenCalledTimes(1)
  })

  it('repassa chatid/isGroup do corpo pra recoverMessages — permite rodar num lote pequeno primeiro', async () => {
    mocks.requireRole.mockResolvedValue(comChannel(CHANNEL))
    mocks.recoverMessages.mockResolvedValue({
      chatsScanned: 1,
      truncated: false,
      inserted: 0,
      alreadyExisted: 0,
      skippedUnparseable: 0,
      errors: 0,
      outcomes: [],
    })

    await POST(request({ ...VALID_BODY, chatid: 'um-chat@s.whatsapp.net', isGroup: true }), {
      params: Promise.resolve({ id: 'chan-1' }),
    })

    const callArgs = mocks.recoverMessages.mock.calls[0]
    expect(callArgs[5]).toMatchObject({ onlyChatid: 'um-chat@s.whatsapp.net', onlyIsGroup: true })
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ForbiddenError } from '@/lib/auth/account'

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  decrypt: vi.fn(),
  previewRecovery: vi.fn(),
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

vi.mock('@/lib/whatsapp/uazapi/recovery-preview', () => ({
  previewRecovery: mocks.previewRecovery,
}))

import { POST } from './route'

const CHANNEL = {
  id: 'chan-1',
  provider: 'uazapi',
  uazapi_base_url: 'https://x.uazapi.com',
  uazapi_token: 'ciphertext',
}

function request(body: unknown) {
  return new Request('http://localhost/api/whatsapp/channels/chan-1/recover-messages/preview', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

function comChannel(channel: Record<string, unknown> | null, existingMessageIds: string[] = []) {
  return {
    supabase: {
      from: (table: string) => {
        if (table === 'whatsapp_channels') {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  maybeSingle: async () => ({ data: channel, error: null }),
                }),
              }),
            }),
          }
        }
        // messages — checagem de quais ids já existem no banco
        return {
          select: () => ({
            in: async () => ({
              data: existingMessageIds.map((message_id) => ({ message_id })),
              error: null,
            }),
          }),
        }
      },
    },
    accountId: 'acct-1',
  }
}

describe('POST /api/whatsapp/channels/[id]/recover-messages/preview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.decrypt.mockReturnValue('token-plano')
  })

  it('exige o papel admin', async () => {
    mocks.requireRole.mockRejectedValue(
      new ForbiddenError("This action requires the 'admin' role or higher"),
    )

    const res = await POST(request({ sinceIso: '2026-10-07T12:00:00Z', untilIso: '2026-10-07T16:00:00Z' }), {
      params: Promise.resolve({ id: 'chan-1' }),
    })

    expect(res.status).toBe(403)
  })

  it('devolve 400 quando falta sinceIso ou untilIso', async () => {
    mocks.requireRole.mockResolvedValue(comChannel(CHANNEL))

    const res = await POST(request({ sinceIso: '2026-10-07T12:00:00Z' }), {
      params: Promise.resolve({ id: 'chan-1' }),
    })

    expect(res.status).toBe(400)
    expect(mocks.previewRecovery).not.toHaveBeenCalled()
  })

  it('devolve 400 quando untilIso não é depois de sinceIso', async () => {
    mocks.requireRole.mockResolvedValue(comChannel(CHANNEL))

    const res = await POST(
      request({ sinceIso: '2026-10-07T16:00:00Z', untilIso: '2026-10-07T12:00:00Z' }),
      { params: Promise.resolve({ id: 'chan-1' }) },
    )

    expect(res.status).toBe(400)
  })

  it('devolve 404 quando o canal não existe (ou é de outra conta)', async () => {
    mocks.requireRole.mockResolvedValue(comChannel(null))

    const res = await POST(request({ sinceIso: '2026-10-07T12:00:00Z', untilIso: '2026-10-07T16:00:00Z' }), {
      params: Promise.resolve({ id: 'chan-1' }),
    })

    expect(res.status).toBe(404)
  })

  it('devolve 400 pra canal Meta (histórico via UAZAPI não se aplica)', async () => {
    mocks.requireRole.mockResolvedValue(comChannel({ ...CHANNEL, provider: 'meta' }))

    const res = await POST(request({ sinceIso: '2026-10-07T12:00:00Z', untilIso: '2026-10-07T16:00:00Z' }), {
      params: Promise.resolve({ id: 'chan-1' }),
    })

    expect(res.status).toBe(400)
  })

  it('200: anota quantas mensagens de cada chat já existem no banco (newCount)', async () => {
    mocks.requireRole.mockResolvedValue(comChannel(CHANNEL, ['MSG_JA_EXISTE']))
    mocks.previewRecovery.mockResolvedValue({
      chatsScanned: 3,
      chatsWithMessages: 1,
      totalMessages: 2,
      truncated: false,
      byChat: [
        {
          chatid: '5511999@s.whatsapp.net',
          isGroup: false,
          count: 2,
          messageIds: ['MSG_JA_EXISTE', 'MSG_NOVA'],
        },
      ],
    })

    const res = await POST(request({ sinceIso: '2026-10-07T12:00:00Z', untilIso: '2026-10-07T16:00:00Z' }), {
      params: Promise.resolve({ id: 'chan-1' }),
    })
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.totalMessages).toBe(2)
    expect(json.byChat[0]).toMatchObject({
      chatid: '5511999@s.whatsapp.net',
      count: 2,
      newCount: 1,
    })
    // ids crus nunca saem da rota — só as contagens.
    expect(json.byChat[0].messageIds).toBeUndefined()
  })
})

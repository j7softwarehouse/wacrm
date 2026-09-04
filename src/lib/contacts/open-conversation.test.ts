import { afterEach, describe, expect, it, vi } from 'vitest'
import { openConversationForContact } from './open-conversation'

describe('openConversationForContact', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns the conversation id on success', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ conversation_id: 'conv-1' }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    const id = await openConversationForContact('contact-1')

    expect(id).toBe('conv-1')
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/whatsapp/conversations/open',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ contact_id: 'contact-1' }),
      }),
    )
  })

  it('throws the server error message when the request fails', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 404,
      json: async () => ({ error: 'Contact not found' }),
    }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(openConversationForContact('contact-1')).rejects.toThrow(
      'Contact not found',
    )
  })
})

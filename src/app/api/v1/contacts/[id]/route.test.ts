import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const mocks = vi.hoisted(() => ({
  requireApiKey: vi.fn(),
  getContactById: vi.fn(),
  setContactTags: vi.fn(),
  resolveAuditUserId: vi.fn(),
}));

vi.mock('@/lib/auth/api-context', () => ({
  requireApiKey: mocks.requireApiKey,
}));

vi.mock('@/lib/api/v1/contacts', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/v1/contacts')>(
    '@/lib/api/v1/contacts'
  );
  return {
    ...actual,
    getContactById: mocks.getContactById,
    setContactTags: mocks.setContactTags,
    resolveAuditUserId: mocks.resolveAuditUserId,
  };
});

import { PATCH } from './route';

// ------------------------------------------------------------
// Chainable Supabase stub. `.select('source')...maybeSingle()` reads
// the row's current source; `.update(payload)...eq()` writes it — the
// payload is captured so a test can assert the promotion rule fired
// (or didn't) without caring about the rest of the update-chain noop.
// ------------------------------------------------------------
function makeSupabase(currentSource: string | null) {
  const updates: unknown[] = [];
  const builder: Record<string, unknown> = {
    select: () => builder,
    update: (payload: unknown) => {
      updates.push(payload);
      return builder;
    },
    eq: () => builder,
    maybeSingle: () =>
      Promise.resolve({
        data: currentSource === null ? null : { source: currentSource },
        error: null,
      }),
    then: (resolve: (v: { error: null }) => void) => resolve({ error: null }),
  };
  const supabase = { from: () => builder } as unknown as SupabaseClient;
  return { supabase, updates };
}

function request(body: unknown) {
  return new Request('http://localhost/api/v1/contacts/contact-1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const params = { params: Promise.resolve({ id: 'contact-1' }) };

beforeEach(() => {
  mocks.requireApiKey.mockReset();
  mocks.getContactById.mockReset();
  mocks.setContactTags.mockReset();
  mocks.resolveAuditUserId.mockReset();
});

describe('PATCH /api/v1/contacts/[id]', () => {
  it('promove um contato whatsapp para manual quando o name muda no patch', async () => {
    const { supabase, updates } = makeSupabase('whatsapp');
    mocks.requireApiKey.mockResolvedValue({
      supabase,
      accountId: 'account-1',
    });
    mocks.getContactById
      .mockResolvedValueOnce({ id: 'contact-1', name: 'old', source: undefined })
      .mockResolvedValueOnce({ id: 'contact-1', name: 'Nova Maria' });

    const response = await PATCH(request({ name: 'Nova Maria' }), params);

    expect(response.status).toBe(200);
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      name: 'Nova Maria',
      source: 'manual',
    });
  });

  it('nao promove quando o contato ja e manual/import', async () => {
    const { supabase, updates } = makeSupabase('manual');
    mocks.requireApiKey.mockResolvedValue({
      supabase,
      accountId: 'account-1',
    });
    mocks.getContactById
      .mockResolvedValueOnce({ id: 'contact-1', name: 'old' })
      .mockResolvedValueOnce({ id: 'contact-1', name: 'Nova Maria' });

    await PATCH(request({ name: 'Nova Maria' }), params);

    expect(updates[0]).not.toHaveProperty('source');
  });

  it('nao promove um contato whatsapp quando outro campo muda mas o name nao', async () => {
    const { supabase, updates } = makeSupabase('whatsapp');
    mocks.requireApiKey.mockResolvedValue({
      supabase,
      accountId: 'account-1',
    });
    mocks.getContactById
      .mockResolvedValueOnce({ id: 'contact-1', name: 'old' })
      .mockResolvedValueOnce({ id: 'contact-1', name: 'old', email: 'a@b.com' });

    await PATCH(request({ email: 'a@b.com' }), params);

    expect(updates[0]).not.toHaveProperty('source');
  });

  it('404 quando o contato nao existe nesta conta', async () => {
    mocks.requireApiKey.mockResolvedValue({
      supabase: makeSupabase(null).supabase,
      accountId: 'account-1',
    });
    mocks.getContactById.mockResolvedValueOnce(null);

    const response = await PATCH(request({ name: 'x' }), params);
    expect(response.status).toBe(404);
  });
});

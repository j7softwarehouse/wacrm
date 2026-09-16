import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  serializeContact,
  findOrCreateContact,
  ContactError,
} from './contacts';

describe('serializeContact', () => {
  it('flattens contact_tags(tags(*)) onto a tags array and nulls missing fields', () => {
    const row = {
      id: 'c1',
      phone: '+14155550123',
      name: 'Jane',
      email: null,
      company: 'Acme',
      avatar_url: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z',
      contact_tags: [
        { tags: { id: 't1', name: 'vip', color: '#fff' } },
        { tags: null }, // orphaned join — dropped
      ],
    };
    expect(serializeContact(row)).toEqual({
      id: 'c1',
      phone: '+14155550123',
      name: 'Jane',
      email: null,
      company: 'Acme',
      avatar_url: null,
      tags: [{ id: 't1', name: 'vip', color: '#fff' }],
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z',
    });
  });

  it('tolerates a row with no contact_tags key', () => {
    const row = {
      id: 'c2',
      phone: '+1',
      name: null,
      email: null,
      company: null,
      avatar_url: null,
      created_at: 'a',
      updated_at: 'b',
    };
    expect(serializeContact(row).tags).toEqual([]);
  });
});

describe('findOrCreateContact', () => {
  const noopDb = {} as SupabaseClient;

  it('rejects a non-E.164 phone with a 400 ContactError', async () => {
    await expect(
      findOrCreateContact(noopDb, 'acc', 'user', { phone: 'not-a-number' })
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      findOrCreateContact(noopDb, 'acc', 'user', { phone: 'not-a-number' })
    ).rejects.toBeInstanceOf(ContactError);
  });

  // Minimal stub covering the two chains findOrCreateContact needs
  // against an existing contact: `select().eq().like()` (findExistingContact)
  // and `update().eq()` (the sync we're testing here).
  function stubDbWithExisting(existing: {
    id: string;
    phone: string;
    name: string | null;
    email: string | null;
    company: string | null;
  }) {
    const updateCalls: Record<string, unknown>[] = [];
    const builder = {
      // `select('*').eq('account_id', ...).like(...)` — findExistingContact.
      select: () => builder,
      eq: () => builder,
      like: () => Promise.resolve({ data: [existing], error: null }),
      // `update(fields).eq('id', ...)` — the sync under test.
      update: (fields: Record<string, unknown>) => {
        updateCalls.push(fields);
        return { eq: () => Promise.resolve({ error: null }) };
      },
    };
    const db = { from: () => builder } as unknown as SupabaseClient;
    return { db, updateCalls };
  }

  it('updates an existing contact when the payload brings a different, non-blank value', async () => {
    const { db, updateCalls } = stubDbWithExisting({
      id: 'c1',
      phone: '+14155550123',
      name: 'Old Name',
      email: null,
      company: null,
    });
    const result = await findOrCreateContact(db, 'acc', 'user', {
      phone: '+14155550123',
      name: 'New Name',
      email: 'new@example.com',
    });
    expect(result).toEqual({ id: 'c1', created: false });
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]).toMatchObject({
      name: 'New Name',
      email: 'new@example.com',
    });
  });

  it('does not call update when nothing in the payload differs from what is stored', async () => {
    const { db, updateCalls } = stubDbWithExisting({
      id: 'c1',
      phone: '+14155550123',
      name: 'Same Name',
      email: null,
      company: null,
    });
    const result = await findOrCreateContact(db, 'acc', 'user', {
      phone: '+14155550123',
      name: 'Same Name',
    });
    expect(result).toEqual({ id: 'c1', created: false });
    expect(updateCalls).toHaveLength(0);
  });
});

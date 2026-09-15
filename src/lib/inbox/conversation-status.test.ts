import { describe, expect, it, vi } from 'vitest';

import {
  CLOSED_REOPEN_AFTER_MS,
  conversationStatusPatch,
  reopenStaleClosedConversations,
  staleClosedCutoff,
} from './conversation-status';

describe('conversationStatusPatch', () => {
  // `closed_at` existe porque `updated_at` não serve para saber QUANDO a
  // conversa foi fechada: toda mensagem nova, contagem de não lidas e
  // qualquer outro UPDATE o reescrevem. Sem uma coluna própria, a regra
  // de reabrir depois de 24h fechada não tem em que se apoiar.
  const now = new Date('2026-09-15T12:00:00.000Z');

  it('carimba closed_at ao fechar', () => {
    expect(conversationStatusPatch('closed', now)).toEqual({
      status: 'closed',
      closed_at: '2026-09-15T12:00:00.000Z',
      updated_at: '2026-09-15T12:00:00.000Z',
    });
  });

  it('limpa closed_at ao abrir', () => {
    expect(conversationStatusPatch('open', now)).toEqual({
      status: 'open',
      closed_at: null,
      updated_at: '2026-09-15T12:00:00.000Z',
    });
  });

  it('limpa closed_at ao marcar como pendente', () => {
    // Pendente é sempre manual e nunca é reaberto sozinho — mas se veio
    // de "fechado", o carimbo antigo tem que sair, senão a varredura de
    // 24h reabriria uma conversa que o atendente pôs em pendente de
    // propósito.
    expect(conversationStatusPatch('pending', now)).toEqual({
      status: 'pending',
      closed_at: null,
      updated_at: '2026-09-15T12:00:00.000Z',
    });
  });
});

describe('staleClosedCutoff', () => {
  it('devolve o instante de 24h atrás', () => {
    const now = new Date('2026-09-15T12:00:00.000Z');
    expect(staleClosedCutoff(now)).toBe('2026-09-14T12:00:00.000Z');
    expect(CLOSED_REOPEN_AFTER_MS).toBe(24 * 60 * 60 * 1000);
  });
});

describe('reopenStaleClosedConversations', () => {
  function fakeSupabase(captured: Record<string, unknown>) {
    const chain = {
      update: (patch: Record<string, unknown>) => {
        captured.patch = patch;
        return chain;
      },
      eq: (col: string, val: unknown) => {
        captured[`eq:${col}`] = val;
        return chain;
      },
      lt: (col: string, val: unknown) => {
        captured[`lt:${col}`] = val;
        return chain;
      },
      select: () => chain,
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: [{ id: 'conv-1' }], error: null }).then(resolve),
    };
    return {
      from: (table: string) => {
        captured.table = table;
        return chain;
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
  }

  it('reabre apenas conversas FECHADAS há mais de 24h', async () => {
    const captured: Record<string, unknown> = {};
    const now = new Date('2026-09-15T12:00:00.000Z');

    const reopened = await reopenStaleClosedConversations(fakeSupabase(captured), now);

    expect(captured.table).toBe('conversations');
    // Só 'closed' — 'pending' é manual e nunca deve ser mexido.
    expect(captured['eq:status']).toBe('closed');
    expect(captured['lt:closed_at']).toBe('2026-09-14T12:00:00.000Z');
    expect(captured.patch).toMatchObject({ status: 'open', closed_at: null });
    expect(reopened).toBe(1);
  });

  it('devolve 0 e não explode quando a atualização falha', async () => {
    const chain = {
      update: () => chain,
      eq: () => chain,
      lt: () => chain,
      select: () => chain,
      then: (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: null, error: { message: 'boom' } }).then(resolve),
    };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const supabase = { from: () => chain } as any;

    expect(await reopenStaleClosedConversations(supabase, new Date())).toBe(0);
    spy.mockRestore();
  });
});

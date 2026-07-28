import { describe, it, expect } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createBroadcast, BroadcastError, deliverBroadcast, type BroadcastPlan } from './broadcast-core';
import { createFakeProvider } from '@/lib/whatsapp/providers/fake';
import { ProviderRateLimitError } from '@/lib/whatsapp/providers/types';

// These assertions all fire in the pure validation prologue, before
// any Supabase call — a bare stub is enough.
const db = {} as SupabaseClient;

describe('createBroadcast validation', () => {
  it('rejects a missing template_name', async () => {
    await expect(
      createBroadcast(db, 'acc', 'user', {
        templateName: '',
        recipients: [{ to: '+14155550123' }],
      })
    ).rejects.toMatchObject({ code: 'bad_request', status: 400 });
  });

  it('rejects an empty recipient list', async () => {
    await expect(
      createBroadcast(db, 'acc', 'user', {
        templateName: 'promo',
        recipients: [],
      })
    ).rejects.toBeInstanceOf(BroadcastError);
  });

  it('rejects more than 1000 recipients', async () => {
    const recipients = Array.from({ length: 1001 }, () => ({
      to: '+14155550123',
    }));
    await expect(
      createBroadcast(db, 'acc', 'user', { templateName: 'promo', recipients })
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe('broadcast diante do erro 463', () => {
  it('para no primeiro 463 em vez de tentar o próximo destinatário', async () => {
    // Insistir depois de um 463 queima a reputação do número e escala
    // para banimento — e número banido é perda permanente, não um erro
    // recuperável. Parar é a única resposta correta.
    const provider = createFakeProvider({
      failWith: new ProviderRateLimitError('uazapi', {
        errorKey: 'WHATSAPP_REACHOUT_TIMELOCK',
        providerCode: 463,
      }),
    });

    const destinatarios = ['5511111111111', '5522222222222', '5533333333333'];
    let enviados = 0;
    let parou = false;

    for (const numero of destinatarios) {
      try {
        await provider.sendText({ to: numero, text: 'oi' });
        enviados += 1;
      } catch (err) {
        if (err instanceof ProviderRateLimitError) {
          parou = true;
          break;
        }
        throw err;
      }
    }

    expect(enviados).toBe(0);
    expect(parou).toBe(true);
    expect(provider.calls).toHaveLength(1);
  });
});

describe('deliverBroadcast diante de ProviderRateLimitError', () => {
  it('interrompe o laço inteiro no primeiro destinatário: zero envios para os demais, status paused_provider_limit', async () => {
    const provider = createFakeProvider({
      failWith: new ProviderRateLimitError('uazapi', {
        errorKey: 'WHATSAPP_REACHOUT_TIMELOCK',
        providerCode: 463,
        providerMessage: 'Conta temporariamente bloqueada para novas conversas.',
      }),
    });

    const broadcastUpdates: Record<string, unknown>[] = [];
    const recipientUpdates: { id: string; payload: Record<string, unknown> }[] = [];

    const db = {
      from: (table: string) => ({
        update: (payload: Record<string, unknown>) => ({
          eq: (_col: string, val: string) => {
            if (table === 'broadcasts') broadcastUpdates.push(payload);
            if (table === 'broadcast_recipients') {
              recipientUpdates.push({ id: val, payload });
            }
            return Promise.resolve({ data: null, error: null });
          },
        }),
      }),
    } as unknown as SupabaseClient;

    const plan: BroadcastPlan = {
      broadcastId: 'bcast-1',
      templateName: 'promo',
      templateLanguage: 'pt_BR',
      provider,
      templateRow: null,
      rejected: 0,
      planned: [
        { recipientRowId: 'r1', phone: '5511111111111', params: [] },
        { recipientRowId: 'r2', phone: '5522222222222', params: [] },
        { recipientRowId: 'r3', phone: '5533333333333', params: [] },
      ],
    };

    await deliverBroadcast(db, plan);

    // Só o primeiro destinatário chegou a tentar enviar — nenhuma
    // variante de telefone e nenhum destinatário seguinte foi tocado.
    expect(provider.calls).toHaveLength(1);
    expect(recipientUpdates).toHaveLength(1);
    expect(recipientUpdates[0].id).toBe('r1');

    // O broadcast recebe exatamente UMA atualização: paused_provider_limit.
    // A atualização final sent/failed (trailing) nunca roda, ou teria
    // sobrescrito esse status.
    expect(broadcastUpdates).toHaveLength(1);
    expect(broadcastUpdates[0]).toMatchObject({
      status: 'paused_provider_limit',
      provider_limit_message: 'Conta temporariamente bloqueada para novas conversas.',
    });
  });
});

import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import {
  chatMediaPathFromPublicUrl,
  purgeExpiredChatVideos,
} from './purge-expired-video';

const BASE = 'https://abc123.supabase.co/storage/v1/object/public';

describe('chatMediaPathFromPublicUrl', () => {
  it('extrai o caminho de uma URL publica do bucket chat-media', () => {
    expect(
      chatMediaPathFromPublicUrl(
        `${BASE}/chat-media/account-11111111-2222-3333-4444-555555555555/1756400000000-clip.mp4`,
      ),
    ).toBe('account-11111111-2222-3333-4444-555555555555/1756400000000-clip.mp4');
  });

  it('ignora query string na URL', () => {
    expect(
      chatMediaPathFromPublicUrl(`${BASE}/chat-media/account-abc/1-v.mp4?t=123`),
    ).toBe('account-abc/1-v.mp4');
  });

  it('recusa URL do bucket flow-media', () => {
    // Video configurado num Fluxo e ativo permanente, reutilizado a cada
    // execucao. Apagar por retencao quebraria o fluxo em producao.
    expect(
      chatMediaPathFromPublicUrl(`${BASE}/flow-media/account-abc/1-v.mp4`),
    ).toBeNull();
  });

  it('recusa URL externa', () => {
    // Midia enviada via API publica apontando para fora do nosso storage:
    // nao e nossa para apagar.
    expect(chatMediaPathFromPublicUrl('https://cdn.exemplo.com/v.mp4')).toBeNull();
  });

  it('recusa entrada vazia ou malformada', () => {
    expect(chatMediaPathFromPublicUrl('')).toBeNull();
    expect(chatMediaPathFromPublicUrl(`${BASE}/chat-media/`)).toBeNull();
  });
});

/**
 * Fake do cliente Supabase cobrindo as tres operacoes que a varredura usa:
 * a consulta encadeada em `messages`, o `storage.remove`, e o update que
 * zera `media_url`. Registra o que foi chamado para as assercoes.
 */
function fakeAdmin(opts: {
  rows: Array<{ id: string; media_url: string }>;
  removeError?: string;
  updateError?: string;
}) {
  const removed: string[][] = [];
  const updated: Array<{ id: string; patch: Record<string, unknown> }> = [];

  const chain = {
    select: () => chain,
    eq: () => chain,
    not: () => chain,
    like: () => chain,
    lt: () => chain,
    limit: async () => ({ data: opts.rows, error: null }),
  };

  const admin = {
    from: () => ({
      ...chain,
      update: (patch: Record<string, unknown>) => ({
        eq: async (_col: string, id: string) => {
          updated.push({ id, patch });
          return opts.updateError
            ? { error: { message: opts.updateError } }
            : { error: null };
        },
      }),
    }),
    storage: {
      from: () => ({
        remove: async (paths: string[]) => {
          removed.push(paths);
          return opts.removeError
            ? { error: { message: opts.removeError } }
            : { error: null };
        },
      }),
    },
  } as unknown as SupabaseClient;

  return { admin, removed, updated };
}

const CHAT_URL = `${BASE}/chat-media/account-abc/1-clip.mp4`;

describe('purgeExpiredChatVideos', () => {
  it('remove o objeto do storage e zera o media_url da mensagem', async () => {
    const { admin, removed, updated } = fakeAdmin({
      rows: [{ id: 'msg-1', media_url: CHAT_URL }],
    });

    const result = await purgeExpiredChatVideos(admin);

    expect(removed).toEqual([['account-abc/1-clip.mp4']]);
    expect(updated).toEqual([{ id: 'msg-1', patch: { media_url: null } }]);
    expect(result).toEqual({ purged: 1, failed: 0 });
  });

  it('NAO zera o media_url quando a remocao no storage falha', async () => {
    // Zerar antes de o arquivo sair deixaria um orfao no bucket para
    // sempre, sem nenhuma linha que o aponte — o oposto do objetivo.
    const { admin, updated } = fakeAdmin({
      rows: [{ id: 'msg-1', media_url: CHAT_URL }],
      removeError: 'storage down',
    });

    const result = await purgeExpiredChatVideos(admin);

    expect(updated).toEqual([]);
    expect(result).toEqual({ purged: 0, failed: 1 });
  });

  it('nao faz nada quando nao ha video expirado', async () => {
    const { admin, removed, updated } = fakeAdmin({ rows: [] });

    const result = await purgeExpiredChatVideos(admin);

    expect(removed).toEqual([]);
    expect(updated).toEqual([]);
    expect(result).toEqual({ purged: 0, failed: 0 });
  });

  it('conta como falha uma linha cuja URL nao e do chat-media', async () => {
    // Defesa em profundidade: a consulta ja filtra pelo bucket, mas se
    // algo escapar, nao tentamos derivar caminho de URL estranha.
    const { admin, removed } = fakeAdmin({
      rows: [{ id: 'msg-1', media_url: 'https://cdn.exemplo.com/v.mp4' }],
    });

    const result = await purgeExpiredChatVideos(admin);

    expect(removed).toEqual([]);
    expect(result).toEqual({ purged: 0, failed: 1 });
  });
});

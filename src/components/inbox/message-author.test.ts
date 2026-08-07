import { describe, expect, it } from 'vitest';

import { shouldShowAuthor } from './message-author';

const base = { sender_type: 'agent' as const, sender_id: 'u1' };

describe('shouldShowAuthor', () => {
  it('mostra o autor na primeira mensagem da conversa', () => {
    expect(shouldShowAuthor(base, null)).toBe(true);
  });

  it('esconde quando o mesmo operador manda em sequencia', () => {
    expect(shouldShowAuthor(base, { ...base })).toBe(false);
  });

  it('mostra quando o operador muda', () => {
    expect(shouldShowAuthor(base, { ...base, sender_id: 'u2' })).toBe(true);
  });

  it('mostra quando a anterior era do contato', () => {
    // A resposta depois de uma fala do cliente sempre reabre o bloco.
    expect(
      shouldShowAuthor(base, { sender_type: 'customer', sender_id: null }),
    ).toBe(true);
  });

  it('nunca mostra autor em mensagem do contato', () => {
    expect(
      shouldShowAuthor({ sender_type: 'customer', sender_id: null }, null),
    ).toBe(false);
  });

  it('trata sistema e humano como autores distintos', () => {
    // Automacao seguida de resposta humana precisa quebrar o bloco.
    expect(shouldShowAuthor(base, { ...base, sender_id: null })).toBe(true);
  });
});

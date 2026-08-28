import { describe, expect, it } from 'vitest';

import { shouldShowAuthor } from './message-author';

const agent = { sender_type: 'agent' as const, sender_id: 'u1' };
const customer = { sender_type: 'customer' as const, sender_id: null };

describe('shouldShowAuthor', () => {
  it('mostra o autor em toda mensagem de agente', () => {
    // Inclui mensagens consecutivas do mesmo operador: a regra anterior
    // so marcava a troca de autor e deixava sequencias inteiras sem
    // identificacao.
    expect(shouldShowAuthor(agent)).toBe(true);
  });

  it('mostra em mensagem de agente sem sender_id (automacao/broadcast)', () => {
    // A decisao de estampar cabe a este modulo; o call site ainda pode
    // omitir o rotulo quando nao conseguir resolver um nome.
    expect(shouldShowAuthor({ ...agent, sender_id: null })).toBe(true);
  });

  it('nunca mostra autor em mensagem do contato', () => {
    // Quem falou e o proprio contato, ja identificado pelo cabecalho.
    expect(shouldShowAuthor(customer)).toBe(false);
  });
});

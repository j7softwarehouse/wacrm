import { describe, expect, it } from 'vitest';
import {
  CONVERSATION_STATUS_DOT_CLASS,
  CONVERSATION_STATUS_TEXT_CLASS,
} from './conversation-status';

describe('conversation-status', () => {
  it('cobre os três status com uma classe de bolinha própria e distinta', () => {
    const values = Object.values(CONVERSATION_STATUS_DOT_CLASS);
    expect(new Set(values).size).toBe(3);
    expect(CONVERSATION_STATUS_DOT_CLASS.open).toBe('bg-status-open');
    expect(CONVERSATION_STATUS_DOT_CLASS.pending).toBe('bg-status-pending');
    expect(CONVERSATION_STATUS_DOT_CLASS.closed).toBe('bg-status-closed');
  });

  it('cobre os três status com uma classe de texto própria e distinta', () => {
    const values = Object.values(CONVERSATION_STATUS_TEXT_CLASS);
    expect(new Set(values).size).toBe(3);
    expect(CONVERSATION_STATUS_TEXT_CLASS.open).toBe('text-status-open');
    expect(CONVERSATION_STATUS_TEXT_CLASS.pending).toBe('text-status-pending');
    expect(CONVERSATION_STATUS_TEXT_CLASS.closed).toBe('text-status-closed');
  });

  it('nenhuma classe referencia --primary ou --muted-foreground', () => {
    // Trava a decisão de design: status não pode voltar a depender do
    // accent da conta nem do muted-foreground (baixo contraste no dark).
    const all = [
      ...Object.values(CONVERSATION_STATUS_DOT_CLASS),
      ...Object.values(CONVERSATION_STATUS_TEXT_CLASS),
    ];
    for (const cls of all) {
      expect(cls).not.toMatch(/primary/);
      expect(cls).not.toMatch(/muted/);
    }
  });
});

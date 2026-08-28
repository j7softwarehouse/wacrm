import { describe, expect, it } from 'vitest';

import { withAgentSignature } from './outbound-signature';

describe('withAgentSignature', () => {
  it('prefixa o texto com o nome em negrito e quebra de linha', () => {
    expect(withAgentSignature('Ramon Paula', 'Oi, tudo bem?')).toBe(
      '*Ramon Paula:*\nOi, tudo bem?'
    );
  });

  it('retorna o texto sem alteração quando não há nome', () => {
    expect(withAgentSignature(null, 'Oi, tudo bem?')).toBe('Oi, tudo bem?');
  });

  it('retorna o texto sem alteração quando o nome é vazio', () => {
    expect(withAgentSignature('', 'Oi, tudo bem?')).toBe('Oi, tudo bem?');
  });
});

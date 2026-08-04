import { describe, expect, it } from 'vitest';

import { CONTACT_SOURCE, isUnidentified } from './source';

describe('CONTACT_SOURCE', () => {
  it('cobre os tres caminhos de criacao', () => {
    expect(CONTACT_SOURCE.WHATSAPP).toBe('whatsapp');
    expect(CONTACT_SOURCE.IMPORT).toBe('import');
    expect(CONTACT_SOURCE.MANUAL).toBe('manual');
  });
});

describe('isUnidentified', () => {
  it('so o contato criado por mensagem recebida e nao identificado', () => {
    expect(isUnidentified('whatsapp')).toBe(true);
    expect(isUnidentified('import')).toBe(false);
    expect(isUnidentified('manual')).toBe(false);
  });

  it('trata ausencia de origem como nao identificado', () => {
    // Linha anterior a migracao, ou schema mais novo que o codigo.
    expect(isUnidentified(null)).toBe(true);
    expect(isUnidentified(undefined)).toBe(true);
  });
});

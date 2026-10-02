import { describe, expect, it } from 'vitest';

import { matchesContactSearch } from './create-group-dialog';

describe('matchesContactSearch', () => {
  it('casa pelo nome (case-insensitive)', () => {
    expect(matchesContactSearch({ name: 'Adriana Mãe do Isaac', phone: '5511999990000' }, 'adriana')).toBe(true);
  });

  it('não casa quando a busca só de letras não aparece no nome', () => {
    // Regressão: "ra" sanitizado como telefone vira string vazia, e
    // TODO telefone contém a string vazia — sem a guarda de
    // phoneQuery.length > 0, isto retornava true e a busca por nome
    // virava um no-op (mostrava todo mundo, sempre).
    expect(matchesContactSearch({ name: 'Daniela', phone: '5511999990000' }, 'ra')).toBe(false);
  });

  it('casa pelo telefone quando a busca tem dígitos', () => {
    expect(matchesContactSearch({ name: 'Gilda', phone: '5511988887777' }, '88887777')).toBe(true);
  });

  it('não casa quando os dígitos da busca não aparecem no telefone', () => {
    expect(matchesContactSearch({ name: 'Gilda', phone: '5511988887777' }, '00000000')).toBe(false);
  });

  it('busca vazia casa com qualquer contato', () => {
    expect(matchesContactSearch({ name: 'Qualquer', phone: '5511999990000' }, '')).toBe(true);
  });

  it('nome nulo não quebra a busca', () => {
    expect(matchesContactSearch({ name: null, phone: '5511999990000' }, 'ra')).toBe(false);
  });
});

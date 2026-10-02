import { describe, expect, it } from 'vitest';

import { buildContactSearchFilter, sanitizeForIlikeFilter } from './create-group-dialog';

describe('sanitizeForIlikeFilter', () => {
  it('mantém letras, números e espaços', () => {
    expect(sanitizeForIlikeFilter('Daniela Mãe 2026')).toBe('Daniela Mãe 2026');
  });

  it('remove vírgula e parênteses — quebram a gramática do filtro or() do PostgREST', () => {
    expect(sanitizeForIlikeFilter('Carla (mãe), Secretaria')).toBe('Carla mãe Secretaria');
  });

  it('remove % e _ — curingas do ILIKE que o usuário não digitaria de propósito', () => {
    expect(sanitizeForIlikeFilter('100%_ok')).toBe('100ok');
  });

  it('remove asterisco — alguns nomes salvos começam com "***"', () => {
    expect(sanitizeForIlikeFilter('*** Daniela')).toBe(' Daniela');
  });
});

describe('buildContactSearchFilter', () => {
  it('busca vazia não produz filtro — chamador não deve bater no banco', () => {
    expect(buildContactSearchFilter('')).toEqual({ orFilter: null });
  });

  it('busca só com caracteres removidos não produz filtro', () => {
    expect(buildContactSearchFilter('***')).toEqual({ orFilter: null });
  });

  it('busca só de letras gera condição de nome, sem condição de telefone', () => {
    expect(buildContactSearchFilter('daniela')).toEqual({
      orFilter: 'name.ilike.%daniela%',
    });
  });

  it('busca só de dígitos gera condição de nome E de telefone (mesma semântica do filtro local)', () => {
    expect(buildContactSearchFilter('11999')).toEqual({
      orFilter: 'name.ilike.%11999%,phone.ilike.%11999%',
    });
  });

  it('telefone formatado é reduzido a dígitos só na condição de telefone — a de nome mantém o hífen, que é texto válido num nome', () => {
    expect(buildContactSearchFilter('(11) 99999-7777')).toEqual({
      orFilter: 'name.ilike.%11 99999-7777%,phone.ilike.%11999997777%',
    });
  });

  it('vírgula na busca nunca aparece crua no filtro final', () => {
    const { orFilter } = buildContactSearchFilter('Carla, mãe');
    expect(orFilter).not.toContain(',,');
    expect(orFilter).not.toMatch(/,$/);
    expect(orFilter).toBe('name.ilike.%Carla mãe%');
  });
});

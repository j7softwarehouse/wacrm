import { describe, expect, it } from 'vitest';

import { canAccessSection, SETTINGS_SECTIONS } from './settings-sections';

describe('canAccessSection', () => {
  it('viewer so acessa as secoes pessoais (Conta) e a Visao geral', () => {
    const allowed = SETTINGS_SECTIONS.filter((s) => canAccessSection(s, 'viewer'));

    expect([...allowed].sort()).toEqual(
      ['overview', 'profile', 'security', 'appearance'].sort(),
    );
  });

  it('agent perde WhatsApp e Grupos, mas mantem o resto do espaco de trabalho', () => {
    expect(canAccessSection('whatsapp', 'agent')).toBe(false);
    expect(canAccessSection('groups', 'agent')).toBe(false);

    const restoDoEspacoDeTrabalho = [
      'templates',
      'quick-replies',
      'fields',
      'deals',
      'members',
      'api',
    ] as const;
    for (const s of restoDoEspacoDeTrabalho) {
      expect(canAccessSection(s, 'agent')).toBe(true);
    }
  });

  it('admin e owner acessam todas as secoes', () => {
    for (const s of SETTINGS_SECTIONS) {
      expect(canAccessSection(s, 'admin')).toBe(true);
      expect(canAccessSection(s, 'owner')).toBe(true);
    }
  });

  it('papel nulo (perfil ainda carregando ou ausente) e tratado como viewer — falha fechado', () => {
    expect(canAccessSection('whatsapp', null)).toBe(false);
    expect(canAccessSection('groups', null)).toBe(false);
    expect(canAccessSection('templates', null)).toBe(false);
    expect(canAccessSection('overview', null)).toBe(true);
    expect(canAccessSection('profile', null)).toBe(true);
  });
});

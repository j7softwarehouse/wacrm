import { describe, expect, it } from 'vitest';

import { canAccessSection, SETTINGS_SECTIONS } from './settings-sections';

describe('canAccessSection', () => {
  it('viewer so acessa as secoes pessoais (Conta) e a Visao geral', () => {
    const allowed = SETTINGS_SECTIONS.filter((s) => canAccessSection(s, 'viewer'));

    expect([...allowed].sort()).toEqual(
      ['overview', 'profile', 'security', 'appearance'].sort(),
    );
  });

  it('agent mantem so as secoes operacionais do espaco de trabalho (2026-09-15)', () => {
    // Modelos, Negocios/moeda, Membros e Chaves de API viraram
    // administracao da conta (spec 2026-09-15-escopo-de-conversas) --
    // so Respostas rapidas e Campos e tags continuam liberados, por
    // serem ferramenta de atendimento do dia a dia.
    const administrativoDoEspacoDeTrabalho = [
      'whatsapp',
      'groups',
      'templates',
      'deals',
      'members',
      'api',
    ] as const;
    for (const s of administrativoDoEspacoDeTrabalho) {
      expect(canAccessSection(s, 'agent')).toBe(false);
    }

    expect(canAccessSection('quick-replies', 'agent')).toBe(true);
    expect(canAccessSection('fields', 'agent')).toBe(true);
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

import { describe, expect, it } from 'vitest';

import { isModuleEnabled, MODULES } from './modules';

describe('isModuleEnabled', () => {
  it('tudo ligado quando nada foi desligado', () => {
    // Opt-out: conta existente, sem configuracao, mantem o
    // comportamento atual inteiro.
    expect(isModuleEnabled([], MODULES.SALES)).toBe(true);
  });

  it('desliga o modulo listado', () => {
    expect(isModuleEnabled(['sales'], MODULES.SALES)).toBe(false);
  });

  it('nao afeta modulos nao listados', () => {
    expect(isModuleEnabled(['outro'], MODULES.SALES)).toBe(true);
  });

  it('trata ausencia de configuracao como tudo ligado', () => {
    expect(isModuleEnabled(null, MODULES.SALES)).toBe(true);
    expect(isModuleEnabled(undefined, MODULES.SALES)).toBe(true);
  });
});

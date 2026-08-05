/**
 * Módulos que uma conta pode desligar.
 *
 * Opt-out de propósito: `disabled_modules` vazio significa tudo
 * ligado, então nenhuma conta existente muda de comportamento quando a
 * coluna aparece. É o que permite um único código servir clientes de
 * ramos diferentes — a escola desliga vendas, um cliente de varejo
 * mantém.
 */
export const MODULES = {
  /** Pipelines, negócios e moeda. */
  SALES: 'sales',
} as const;

export type ModuleName = (typeof MODULES)[keyof typeof MODULES];

export function isModuleEnabled(
  disabledModules: string[] | null | undefined,
  moduleName: ModuleName,
): boolean {
  if (!disabledModules) return true;
  return !disabledModules.includes(moduleName);
}

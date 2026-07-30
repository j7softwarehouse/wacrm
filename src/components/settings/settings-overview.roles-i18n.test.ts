import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import en from "../../../messages/en.json";
import ko from "../../../messages/ko.json";
import pt from "../../../messages/pt.json";

// Regressao: SettingsOverview chamava useTranslations('roles') esperando um
// namespace de topo, mas 'roles' sempre viveu aninhado em Settings.roles nos
// tres arquivos de mensagens. next-intl resolve o namespace navegando pelas
// chaves separadas por ponto, entao 'roles' nunca existiu e todo acesso a
// tRoles(accountRole!) explodia com MISSING_MESSAGE em qualquer locale.
function resolveNamespace(
  messages: Record<string, unknown>,
  namespace: string,
): unknown {
  return namespace
    .split(".")
    .reduce<unknown>(
      (acc, key) =>
        acc && typeof acc === "object" ? (acc as Record<string, unknown>)[key] : undefined,
      messages,
    );
}

const ROLE_KEYS = ["owner", "admin", "agent", "viewer"];

describe("Settings.roles i18n namespace", () => {
  it.each([
    ["pt", pt],
    ["en", en],
    ["ko", ko],
  ])("nao existe namespace de topo 'roles' em %s.json", (_locale, messages) => {
    expect(resolveNamespace(messages, "roles")).toBeUndefined();
  });

  it.each([
    ["pt", pt],
    ["en", en],
    ["ko", ko],
  ])("Settings.roles em %s.json tem as 4 chaves de papel", (_locale, messages) => {
    const roles = resolveNamespace(messages, "Settings.roles");
    expect(roles).toBeTypeOf("object");
    for (const key of ROLE_KEYS) {
      expect(roles).toHaveProperty(key);
      expect(typeof (roles as Record<string, unknown>)[key]).toBe("string");
    }
  });

  it("settings-overview.tsx usa o namespace correto 'Settings.roles'", () => {
    const source = readFileSync(
      join(__dirname, "settings-overview.tsx"),
      "utf-8",
    );
    expect(source).not.toContain("useTranslations('roles')");
    expect(source).toContain("useTranslations('Settings.roles')");
  });
});

import { describe, expect, it } from "vitest";
import { defaultChannelSupportsTemplates } from "./default-channel";

describe("defaultChannelSupportsTemplates", () => {
  it("uazapi como canal mais antigo -> não suporta", () => {
    expect(defaultChannelSupportsTemplates("uazapi")).toBe(false);
  });

  it("meta como canal mais antigo -> suporta", () => {
    expect(defaultChannelSupportsTemplates("meta")).toBe(true);
  });

  it("null (carregando, ou sem canal ainda) -> fail-open, suporta", () => {
    expect(defaultChannelSupportsTemplates(null)).toBe(true);
  });
});

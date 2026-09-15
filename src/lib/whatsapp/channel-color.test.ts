import { describe, expect, it } from "vitest";

import { channelColor } from "./channel-color";

describe("channelColor", () => {
  it("e deterministico: o mesmo id sempre devolve a mesma cor", () => {
    const id = "38a1a716-2b69-4043-a902-1c247a0eeb42";
    expect(channelColor(id)).toEqual(channelColor(id));
  });

  it("ids diferentes tendem a cair em cores diferentes", () => {
    // Não é garantia matemática (hash pode colidir), mas com uma paleta
    // de vários tons e 3 ids reais de UUID, é o comportamento esperado —
    // serve de rede de proteção contra "sempre devolve a primeira cor".
    const a = channelColor("38a1a716-2b69-4043-a902-1c247a0eeb42");
    const b = channelColor("987dd01c-2caf-4d6c-b9e6-d618f4e2fd9b");
    const c = channelColor("c83067ed-9541-42ad-9562-60c6ff87e26b");
    const distinct = new Set([a.dot, b.dot, c.dot]);
    expect(distinct.size).toBeGreaterThan(1);
  });

  it("devolve as tres classes (dot, text, border) sempre preenchidas", () => {
    const color = channelColor("qualquer-id");
    expect(color.dot).toMatch(/^bg-/);
    expect(color.text).toMatch(/^text-/);
    expect(color.border).toMatch(/^border-/);
  });
});

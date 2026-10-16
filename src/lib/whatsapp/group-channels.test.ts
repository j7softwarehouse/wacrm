import { describe, expect, it } from "vitest";
import { channelsForGroupCreation, defaultGroupChannelId } from "./group-channels";

const ch = (over: Record<string, unknown>) =>
  ({
    id: "c",
    provider: "uazapi",
    status: "connected",
    label: "Canal",
    ...over,
  }) as Parameters<typeof channelsForGroupCreation>[0][number];

// Só a UAZAPI cria grupo (a Cloud API da Meta não tem essa operação), e
// canal desconectado não consegue criar — mas continua listado, para a
// pessoa ver que o número existe e por que não dá para escolhê-lo.
describe("channelsForGroupCreation", () => {
  it("lista só canais UAZAPI e marca quais estão conectados", () => {
    const out = channelsForGroupCreation([
      ch({ id: "a", status: "connected" }),
      ch({ id: "b", status: "disconnected" }),
      ch({ id: "m", provider: "meta" }),
    ]);

    expect(out.map((c) => [c.id, c.selectable])).toEqual([
      ["a", true],
      ["b", false],
    ]);
  });

  it("usa o nome do canal (label) ou o telefone como rótulo", () => {
    const out = channelsForGroupCreation([
      ch({ id: "a", label: "Canal Principal", phone_e164: "553133982291" }),
      ch({ id: "b", label: undefined, phone_e164: "553189891123" }),
    ]);

    expect(out.map((c) => c.label)).toEqual(["Canal Principal", "553189891123"]);
  });
});

describe("defaultGroupChannelId", () => {
  it("com um único canal selecionável, já devolve ele (nada a escolher)", () => {
    const out = channelsForGroupCreation([ch({ id: "a" }), ch({ id: "b", status: "disconnected" })]);
    expect(defaultGroupChannelId(out)).toBe("a");
  });

  it("com 2+ canais selecionáveis NÃO escolhe por conta própria — a pessoa decide", () => {
    const out = channelsForGroupCreation([ch({ id: "a" }), ch({ id: "b" })]);
    expect(defaultGroupChannelId(out)).toBe("");
  });

  it("sem canal selecionável devolve vazio", () => {
    expect(defaultGroupChannelId([])).toBe("");
  });
});

import { describe, expect, it } from "vitest";
import { countPollVotes } from "./poll-votes";

describe("countPollVotes", () => {
  it("zera todas as opções quando não há votos", () => {
    expect(countPollVotes(["Segunda", "Sexta"], [])).toEqual({
      total: 0,
      counts: { Segunda: 0, Sexta: 0 },
    });
  });

  it("conta uma pessoa por voto e ignora quem desmarcou tudo", () => {
    const votes = [
      { options: ["Segunda"] },
      { options: ["Sexta"] },
      { options: [] },
    ];
    expect(countPollVotes(["Segunda", "Sexta"], votes)).toEqual({
      total: 2,
      counts: { Segunda: 1, Sexta: 1 },
    });
  });

  it("aceita escolha múltipla: quem marcou duas opções conta nas duas e no total uma vez", () => {
    const votes = [{ options: ["Segunda", "Sexta"] }, { options: ["Sexta"] }];
    expect(countPollVotes(["Segunda", "Sexta"], votes)).toEqual({
      total: 2,
      counts: { Segunda: 1, Sexta: 2 },
    });
  });

  it("não conta opção que não existe na enquete", () => {
    expect(countPollVotes(["Segunda"], [{ options: ["Domingo"] }])).toEqual({
      total: 1,
      counts: { Segunda: 0 },
    });
  });
});

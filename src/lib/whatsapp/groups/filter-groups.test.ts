import { describe, expect, it } from "vitest";
import { filterGroupsByName } from "./filter-groups";

const g = (id: string, name: string | null) => ({ id, name });

// A lista de Configurações > Grupos cresceu (dezenas de grupos) e não
// tinha busca — a faixa de aviso no topo parecia uma barra de busca e
// não era (relato de 16/10/2026).
describe("filterGroupsByName", () => {
  const groups = [
    g("1", "Grupo Maternal II"),
    g("2", "Aula de Balé e Jazz"),
    g("3", "Administrativo e Secretaria Emanuel"),
    g("4", null),
  ];

  it("devolve a lista inteira (mesmo array) quando a busca está vazia", () => {
    expect(filterGroupsByName(groups, "")).toBe(groups);
    expect(filterGroupsByName(groups, "   ")).toBe(groups);
  });

  it("acha por parte do nome, sem diferenciar maiúsculas", () => {
    expect(filterGroupsByName(groups, "maternal").map((x) => x.id)).toEqual(["1"]);
    expect(filterGroupsByName(groups, "AULA").map((x) => x.id)).toEqual(["2"]);
  });

  it("ignora acentos nos dois sentidos (bale acha Balé; Secretária acha Secretaria)", () => {
    expect(filterGroupsByName(groups, "bale").map((x) => x.id)).toEqual(["2"]);
    expect(filterGroupsByName(groups, "secretária").map((x) => x.id)).toEqual(["3"]);
  });

  it("acha mais de um grupo e mantém a ordem original", () => {
    expect(filterGroupsByName(groups, "e").map((x) => x.id)).toEqual(["1", "2", "3"]);
  });

  it("grupo sem nome nunca casa com uma busca preenchida", () => {
    expect(filterGroupsByName(groups, "sem nome")).toEqual([]);
  });

  it("devolve lista vazia quando nada casa", () => {
    expect(filterGroupsByName(groups, "xadrez")).toEqual([]);
  });
});

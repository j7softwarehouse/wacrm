import { describe, expect, it } from "vitest";

import { findGroupsWithoutConversation, type SearchableGroup } from "./group-search";
import type { Conversation } from "@/types";

function group(overrides: Partial<SearchableGroup> = {}): SearchableGroup {
  return {
    id: "g-1",
    name: "Turma da Manhã",
    avatar_url: null,
    enabled: true,
    left_at: null,
    ...overrides,
  };
}

function conversation(overrides: Partial<Conversation> = {}): Conversation {
  return {
    id: "c-1",
    account_id: "acc-1",
    status: "open",
    unread_count: 0,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  } as Conversation;
}

describe("findGroupsWithoutConversation", () => {
  it("nao devolve nada para busca vazia", () => {
    const result = findGroupsWithoutConversation([group()], [], "");
    expect(result).toEqual([]);
  });

  it("nao devolve nada para busca só com espaços", () => {
    const result = findGroupsWithoutConversation([group()], [], "   ");
    expect(result).toEqual([]);
  });

  it("acha grupo cujo nome bate com a busca, sem diferenciar maiúsculas", () => {
    const result = findGroupsWithoutConversation(
      [group({ id: "g-1", name: "Turma da Manhã" })],
      [],
      "turma",
    );
    expect(result.map((g) => g.id)).toEqual(["g-1"]);
  });

  it("nao acha grupo cujo nome nao bate", () => {
    const result = findGroupsWithoutConversation(
      [group({ id: "g-1", name: "Turma da Manhã" })],
      [],
      "financeiro",
    );
    expect(result).toEqual([]);
  });

  it("exclui grupo que ja tem conversa carregada", () => {
    const result = findGroupsWithoutConversation(
      [group({ id: "g-1", name: "Turma da Manhã" })],
      [conversation({ group_id: "g-1" })],
      "turma",
    );
    expect(result).toEqual([]);
  });

  it("nao exclui um grupo diferente so porque outro grupo tem conversa", () => {
    const result = findGroupsWithoutConversation(
      [
        group({ id: "g-1", name: "Turma da Manhã" }),
        group({ id: "g-2", name: "Turma da Tarde" }),
      ],
      [conversation({ group_id: "g-1" })],
      "turma",
    );
    expect(result.map((g) => g.id)).toEqual(["g-2"]);
  });

  it("exclui grupo desabilitado — /groups/[id]/open recusaria com 400", () => {
    const result = findGroupsWithoutConversation(
      [group({ id: "g-1", name: "Turma da Manhã", enabled: false })],
      [],
      "turma",
    );
    expect(result).toEqual([]);
  });

  it("exclui grupo que o numero ja abandonou (left_at preenchido)", () => {
    const result = findGroupsWithoutConversation(
      [group({ id: "g-1", name: "Turma da Manhã", left_at: "2026-09-01T00:00:00Z" })],
      [],
      "turma",
    );
    expect(result).toEqual([]);
  });

  it("ignora conversas 1:1 (group_id nulo) ao montar o conjunto de exclusao", () => {
    const result = findGroupsWithoutConversation(
      [group({ id: "g-1", name: "Turma da Manhã" })],
      [conversation({ group_id: null, contact_id: "contact-1" })],
      "turma",
    );
    expect(result.map((g) => g.id)).toEqual(["g-1"]);
  });
});

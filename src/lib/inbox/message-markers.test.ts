import { describe, expect, it } from "vitest";
import {
  canRemoveMarker,
  groupMarkersByConversation,
  markerChipText,
  type MarkerWithContext,
} from "./message-markers";

describe("canRemoveMarker", () => {
  it("quem marcou pode remover", () => {
    expect(canRemoveMarker({ created_by: "user-1" }, "user-1", false)).toBe(true);
  });

  it("outro agente comum nao pode remover", () => {
    expect(canRemoveMarker({ created_by: "user-1" }, "user-2", false)).toBe(false);
  });

  it("admin pode remover marcador de qualquer pessoa", () => {
    expect(canRemoveMarker({ created_by: "user-1" }, "user-2", true)).toBe(true);
  });
});

describe("markerChipText", () => {
  it("mostra rotulo e nome de quem marcou, separados por ponto médio", () => {
    expect(markerChipText("Financeiro", "Paulo")).toBe("Financeiro · Paulo");
  });

  it("sem rotulo, mostra só o nome", () => {
    expect(markerChipText(null, "Paulo")).toBe("Paulo");
    expect(markerChipText("", "Paulo")).toBe("Paulo");
  });

  it("rotulo só com espaços conta como ausente", () => {
    expect(markerChipText("   ", "Paulo")).toBe("Paulo");
  });
});

describe("groupMarkersByConversation", () => {
  function marker(over: Partial<MarkerWithContext>): MarkerWithContext {
    return {
      id: "mk-1",
      conversationId: "conv-1",
      messageId: "msg-1",
      label: null,
      createdAt: "2026-09-16T10:00:00.000Z",
      contactName: "Maria Souza",
      messagePreview: "Bom dia",
      ...over,
    };
  }

  it("agrupa por conversa, preservando os marcadores de cada uma", () => {
    const groups = groupMarkersByConversation([
      marker({ id: "mk-1", conversationId: "conv-1", contactName: "Maria Souza" }),
      marker({ id: "mk-2", conversationId: "conv-2", contactName: "João Lima" }),
      marker({ id: "mk-3", conversationId: "conv-1", contactName: "Maria Souza", label: "Financeiro" }),
    ]);

    expect(groups).toHaveLength(2);
    const maria = groups.find((g) => g.conversationId === "conv-1");
    expect(maria?.markers.map((m) => m.id)).toEqual(["mk-1", "mk-3"]);
    expect(maria?.contactName).toBe("Maria Souza");
  });

  it("ordena os grupos pelo marcador mais recente primeiro", () => {
    const groups = groupMarkersByConversation([
      marker({ id: "mk-old", conversationId: "conv-old", createdAt: "2026-09-10T00:00:00.000Z" }),
      marker({ id: "mk-new", conversationId: "conv-new", createdAt: "2026-09-16T00:00:00.000Z" }),
    ]);

    expect(groups.map((g) => g.conversationId)).toEqual(["conv-new", "conv-old"]);
  });

  it("dentro do grupo, ordena os marcadores mais recentes primeiro", () => {
    const groups = groupMarkersByConversation([
      marker({ id: "mk-a", conversationId: "conv-1", createdAt: "2026-09-16T08:00:00.000Z" }),
      marker({ id: "mk-b", conversationId: "conv-1", createdAt: "2026-09-16T09:00:00.000Z" }),
    ]);

    expect(groups[0].markers.map((m) => m.id)).toEqual(["mk-b", "mk-a"]);
  });

  it("lista vazia devolve array vazio", () => {
    expect(groupMarkersByConversation([])).toEqual([]);
  });
});

import { describe, it, expect } from "vitest";
import {
  channelLabel,
  conversationDisplayName,
  matchesContactFilters,
  normalizeConversation,
} from "./conversations";
import type { Conversation } from "@/types";

function makeConversation(
  contact: Partial<Conversation["contact"]> | null,
): Conversation {
  return {
    id: "c1",
    user_id: "u1",
    contact_id: "ct1",
    status: "open",
    unread_count: 0,
    created_at: "",
    updated_at: "",
    contact: contact
      ? {
          id: "ct1",
          user_id: "u1",
          account_id: "a1",
          phone: "123",
          created_at: "",
          updated_at: "",
          ...contact,
        }
      : undefined,
  };
}

const tag = (id: string, name = id) => ({
  id,
  user_id: "u1",
  name,
  color: "#fff",
  created_at: "",
});

describe("matchesContactFilters", () => {
  it("matches everything when no filters are set", () => {
    const conv = makeConversation({ company: "Acme", tags: [tag("t1")] });
    expect(matchesContactFilters(conv, { tagIds: [], company: null })).toBe(
      true,
    );
    expect(makeConversation(null)).toBeDefined();
    expect(
      matchesContactFilters(makeConversation(null), {
        tagIds: [],
        company: null,
      }),
    ).toBe(true);
  });

  it("uses OR logic across tags", () => {
    const conv = makeConversation({ tags: [tag("t1"), tag("t2")] });
    expect(
      matchesContactFilters(conv, { tagIds: ["t2", "t9"], company: null }),
    ).toBe(true);
    expect(
      matchesContactFilters(conv, { tagIds: ["t9"], company: null }),
    ).toBe(false);
  });

  it("excludes conversations whose contact has no tags when a tag filter is active", () => {
    const conv = makeConversation({ tags: [] });
    expect(
      matchesContactFilters(conv, { tagIds: ["t1"], company: null }),
    ).toBe(false);
    expect(
      matchesContactFilters(makeConversation(null), {
        tagIds: ["t1"],
        company: null,
      }),
    ).toBe(false);
  });

  it("matches company exactly, trimming whitespace", () => {
    const conv = makeConversation({ company: "  Acme  " });
    expect(
      matchesContactFilters(conv, { tagIds: [], company: "Acme" }),
    ).toBe(true);
    expect(
      matchesContactFilters(conv, { tagIds: [], company: "Other" }),
    ).toBe(false);
  });

  it("requires both tag and company to match when both are set (AND across facets)", () => {
    const conv = makeConversation({ company: "Acme", tags: [tag("t1")] });
    expect(
      matchesContactFilters(conv, { tagIds: ["t1"], company: "Acme" }),
    ).toBe(true);
    expect(
      matchesContactFilters(conv, { tagIds: ["t1"], company: "Other" }),
    ).toBe(false);
    expect(
      matchesContactFilters(conv, { tagIds: ["tX"], company: "Acme" }),
    ).toBe(false);
  });
});

describe("normalizeConversation", () => {
  it("flattens embedded contact_tags into contact.tags", () => {
    const raw = {
      id: "c1",
      user_id: "u1",
      contact_id: "ct1",
      status: "open" as const,
      unread_count: 0,
      created_at: "",
      updated_at: "",
      contact: {
        id: "ct1",
        user_id: "u1",
        account_id: "a1",
        phone: "123",
        created_at: "",
        updated_at: "",
        contact_tags: [{ tags: tag("t1", "VIP") }, { tags: null }],
      },
    };
    const normalized = normalizeConversation(raw);
    expect(normalized.contact?.tags).toEqual([tag("t1", "VIP")]);
    // The raw join key is dropped from the flattened contact.
    expect(
      (normalized.contact as unknown as Record<string, unknown>).contact_tags,
    ).toBeUndefined();
  });

  it("passes through a conversation with no contact", () => {
    const raw = {
      id: "c1",
      user_id: "u1",
      contact_id: "ct1",
      status: "open" as const,
      unread_count: 0,
      created_at: "",
      updated_at: "",
      contact: null,
    };
    // A contactless row passes through untouched (consumers use `?.`).
    expect(normalizeConversation(raw).contact).toBeNull();
  });
});

describe("conversationDisplayName", () => {
  // Bug real da verificação ponta-a-ponta (Tarefa 12): CONVERSATION_SELECT
  // nunca juntava whatsapp_groups, então uma conversa de grupo (contact_id
  // null) sempre caía no fallback "Desconhecido" na lista da Inbox.
  it("usa o nome do grupo quando não há contato", () => {
    const conv = {
      group: { id: "g1", name: "Teste", avatar_url: null },
      contact: null,
    };
    expect(conversationDisplayName(conv)).toBe("Teste");
  });

  it("usa o nome do contato no caminho 1:1 (sem grupo)", () => {
    const conv = {
      group: undefined,
      contact: { name: "Fulano", phone: "5511999999999" } as Conversation["contact"],
    };
    expect(conversationDisplayName(conv)).toBe("Fulano");
  });

  it("cai para o telefone do contato quando o contato não tem nome", () => {
    const conv = {
      group: undefined,
      contact: { name: undefined, phone: "5511999999999" } as unknown as Conversation["contact"],
    };
    expect(conversationDisplayName(conv)).toBe("5511999999999");
  });

  it("devolve null quando não há grupo nem contato (chamador decide o fallback)", () => {
    expect(conversationDisplayName({ group: undefined, contact: undefined })).toBeNull();
  });
});

describe("channelLabel", () => {
  it("prefers the custom label over the phone number", () => {
    expect(channelLabel({ label: "Suporte", phone_e164: "+551199998888" })).toBe(
      "Suporte",
    );
  });

  it("falls back to the phone number when there's no label", () => {
    expect(channelLabel({ label: undefined, phone_e164: "+551199998888" })).toBe(
      "+551199998888",
    );
  });

  it("returns undefined when neither is set (never-connected channel)", () => {
    expect(channelLabel({ label: undefined, phone_e164: undefined })).toBeUndefined();
  });
});

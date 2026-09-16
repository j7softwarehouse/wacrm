import { describe, expect, it, vi } from "vitest";
import { buildReplyPreview } from "./reply-quote";

const t = ((key: string) => `[${key}]`) as unknown as Parameters<
  typeof buildReplyPreview
>[1];

describe("buildReplyPreview", () => {
  it("mensagem apagada mostra o placeholder, mesmo com content_text preservado no banco", () => {
    const message = {
      id: "m-1",
      conversation_id: "c-1",
      sender_type: "agent" as const,
      content_type: "text" as const,
      content_text: "texto que ainda está no banco",
      status: "sent" as const,
      created_at: "2026-09-10T00:00:00Z",
      deleted_at: "2026-09-10T01:00:00Z",
    };
    expect(buildReplyPreview(message, t)).toBe("[deletedMessage]");
  });

  it("mensagem de texto normal mostra o content_text", () => {
    const message = {
      id: "m-1",
      conversation_id: "c-1",
      sender_type: "agent" as const,
      content_type: "text" as const,
      content_text: "oi",
      status: "sent" as const,
      created_at: "2026-09-10T00:00:00Z",
    };
    expect(buildReplyPreview(message, t)).toBe("oi");
  });
});

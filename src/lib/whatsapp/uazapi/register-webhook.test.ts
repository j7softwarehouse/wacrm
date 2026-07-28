// ============================================================
// registerUazapiWebhook nunca deve registrar o webhook contra o
// domínio de marketing que `getBaseUrl` usa como último recurso
// quando não consegue derivar a origem real da requisição — isso
// apontaria o segredo do canal (e todo o tráfego de entrada) para um
// domínio de terceiros, e carimbaria `webhook_registered_at` como se
// tivesse funcionado, bloqueando qualquer nova tentativa.
// ============================================================

import { beforeEach, describe, expect, it, vi } from "vitest";

import { MARKETING_FALLBACK_BASE_URL } from "@/lib/http/base-url";
import type { UazapiClient } from "./client";
import { registerUazapiWebhook } from "./register-webhook";

function createFakeDb() {
  const update = vi.fn(() => ({
    eq: vi.fn(async () => ({ error: null })),
  }));
  const from = vi.fn(() => ({ update }));
  return { from } as unknown as Parameters<typeof registerUazapiWebhook>[0] & {
    from: typeof from;
  };
}

function createFakeClient(
  post: (path: string, body: unknown) => Promise<unknown> = vi.fn(),
): UazapiClient {
  return { post: post as UazapiClient["post"], get: vi.fn() };
}

const channel = { id: "chan-1", webhook_secret: "a".repeat(64) };

describe("registerUazapiWebhook", () => {
  beforeEach(() => vi.clearAllMocks());

  it("recusa registrar contra o fallback de marketing e grava last_error", async () => {
    const db = createFakeDb();
    const post = vi.fn();
    const client = createFakeClient(post);

    const result = await registerUazapiWebhook(
      db,
      client,
      channel,
      MARKETING_FALLBACK_BASE_URL,
    );

    expect(result).toBe(false);
    // Nunca deve sequer tentar falar com a UAZAPI.
    expect(post).not.toHaveBeenCalled();

    const updateCall = db.from.mock.results[0].value.update.mock.calls[0][0];
    expect(updateCall.webhook_registered_at).toBeUndefined();
    expect(updateCall.last_error).toContain("URL pública");
  });

  it("recusa mesmo com barra final (mesma normalização usada para montar a URL)", async () => {
    const db = createFakeDb();
    const client = createFakeClient();

    const result = await registerUazapiWebhook(
      db,
      client,
      channel,
      `${MARKETING_FALLBACK_BASE_URL}/`,
    );

    expect(result).toBe(false);
  });

  it("registra normalmente quando a URL base é confiável", async () => {
    const db = createFakeDb();
    const post = vi.fn(async () => ({}));
    const client = createFakeClient(post);

    const result = await registerUazapiWebhook(
      db,
      client,
      channel,
      "https://crm.example.com",
    );

    expect(result).toBe(true);
    expect(post).toHaveBeenCalledWith(
      "/webhook",
      expect.objectContaining({
        url: `https://crm.example.com/api/whatsapp/uazapi/webhook/${channel.webhook_secret}`,
      }),
    );

    const updateCall = db.from.mock.results[0].value.update.mock.calls[0][0];
    expect(updateCall.webhook_registered_at).toBeTruthy();
    expect(updateCall.last_error).toBeNull();
  });
});

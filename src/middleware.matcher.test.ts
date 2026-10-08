import { describe, expect, it, vi } from "vitest";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";

vi.mock("@supabase/ssr", () => ({ createServerClient: () => ({}) }));

const { config } = await import("./middleware");

const roda = (url: string, headers?: Record<string, string>) =>
  unstable_doesMiddlewareMatch({ config, url, headers });

// Cada execução do middleware conta no consumo de CPU da Vercel (plano
// Fluid). Estas rotas já se autenticam sozinhas (segredo de cron,
// assinatura do webhook, chave de API) — o middleware não faz nada útil
// nelas além de consultar o Supabase à toa. Ver wacrm-migracao-vercel-nova-conta.
describe("middleware matcher — não roda onde não adiciona nada", () => {
  it.each([
    "/api/whatsapp/uazapi/webhook/abc123",
    "/api/whatsapp/webhook",
    "/api/whatsapp/groups/sync-cron",
    "/api/automations/cron",
    "/api/flows/cron",
    "/api/media/cron",
    "/api/v1/messages",
    "/icon",
  ])("%s NÃO passa pelo middleware", (url) => {
    expect(roda(url)).toBe(false);
  });

  it("pré-carregamento de link (prefetch) NÃO passa pelo middleware", () => {
    expect(roda("/inbox", { "next-router-prefetch": "1" })).toBe(false);
  });
});

describe("middleware matcher — continua rodando onde precisa", () => {
  it.each([
    "/dashboard",
    "/inbox",
    "/settings",
    "/login",
    "/join/token-123",
    "/api/whatsapp/send",
    "/api/whatsapp/channels/123/webhook-url",
    "/api/account/members",
  ])("%s passa pelo middleware", (url) => {
    expect(roda(url)).toBe(true);
  });

  it("navegação real (sem header de prefetch) continua passando", () => {
    expect(roda("/inbox")).toBe(true);
  });
});

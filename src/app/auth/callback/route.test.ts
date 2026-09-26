import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));

import { GET } from "./route";

function comSupabase(exchangeResult: { error: Error | null }) {
  return {
    auth: {
      exchangeCodeForSession: vi.fn(async () => exchangeResult),
    },
  };
}

describe("GET /auth/callback", () => {
  beforeEach(() => vi.clearAllMocks());

  it("troca o code por sessão e redireciona pro `next` informado", async () => {
    const supabase = comSupabase({ error: null });
    mocks.createClient.mockResolvedValue(supabase);

    const res = await GET(
      new Request("https://x.test/auth/callback?code=abc123&next=/reset-password"),
    );

    expect(supabase.auth.exchangeCodeForSession).toHaveBeenCalledWith("abc123");
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://x.test/reset-password");
  });

  it("usa /dashboard como destino padrão quando `next` não é informado", async () => {
    const supabase = comSupabase({ error: null });
    mocks.createClient.mockResolvedValue(supabase);

    const res = await GET(new Request("https://x.test/auth/callback?code=abc123"));

    expect(res.headers.get("location")).toBe("https://x.test/dashboard");
  });

  it("manda pro login com aviso quando não há `code` na URL", async () => {
    const res = await GET(new Request("https://x.test/auth/callback?next=/reset-password"));

    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(res.headers.get("location")).toBe("https://x.test/login?error=auth_callback_failed");
  });

  it("manda pro login com aviso quando o Supabase recusa o code (expirado/já usado)", async () => {
    const supabase = comSupabase({ error: new Error("invalid or expired code") });
    mocks.createClient.mockResolvedValue(supabase);

    const res = await GET(
      new Request("https://x.test/auth/callback?code=expirado&next=/reset-password"),
    );

    expect(res.headers.get("location")).toBe("https://x.test/login?error=auth_callback_failed");
  });
});

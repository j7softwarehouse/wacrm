import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentAccount: vi.fn(),
  uazapiGet: vi.fn(),
}));

vi.mock("@/lib/auth/account", () => ({
  getCurrentAccount: mocks.getCurrentAccount,
  toErrorResponse: (err: unknown) =>
    Response.json(
      { error: err instanceof Error ? err.message : "unknown" },
      { status: 500 },
    ),
}));

vi.mock("@/lib/whatsapp/uazapi/client", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/whatsapp/uazapi/client")>();
  return {
    ...actual,
    createUazapiClient: () => ({ get: mocks.uazapiGet, post: vi.fn() }),
  };
});

const { generateWebhookSecret, POST } = await import("./route");

describe("POST /api/whatsapp/channels", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.uazapiGet.mockResolvedValue({ instance: { id: "inst-1" } });
  });

  function request(body: unknown) {
    return new Request("http://localhost/api/whatsapp/channels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("sempre inclui user_id no insert — coluna NOT NULL desde a 001/017", async () => {
    // Regressão: esta rota já foi ao ar sem `user_id` no payload,
    // violando `whatsapp_channels.user_id NOT NULL` em todo cadastro
    // de canal UAZAPI (só descoberto testando contra o banco real —
    // nada aqui exercitava o handler de verdade antes). Mesma classe
    // de bug do `provider` ausente em config/route.ts.
    const insertedRows: Record<string, unknown>[] = [];
    mocks.getCurrentAccount.mockResolvedValue({
      supabase: {
        from: () => ({
          insert: (row: Record<string, unknown>) => {
            insertedRows.push(row);
            return {
              select: () => ({
                single: async () => ({
                  data: { id: "chan-1", ...row },
                  error: null,
                }),
              }),
            };
          },
        }),
      },
      accountId: "acc-1",
      userId: "user-1",
    });

    const response = await POST(
      request({
        provider: "uazapi",
        label: "Recepção",
        baseUrl: "https://x.uazapi.com",
        token: "TOKEN",
      }),
    );

    expect(response.status).toBe(200);
    expect(insertedRows).toHaveLength(1);
    expect(insertedRows[0].user_id).toBe("user-1");
    expect(insertedRows[0].account_id).toBe("acc-1");
  });
});

describe("generateWebhookSecret", () => {
  it("gera um segredo longo o bastante para ser inadivinhável", () => {
    // Ele é a única autenticação do webhook de entrada: a UAZAPI não
    // assina o corpo como a Meta faz com HMAC.
    const secret = generateWebhookSecret();
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
  });

  it("gera um valor diferente a cada chamada", () => {
    const secrets = new Set(
      Array.from({ length: 50 }, () => generateWebhookSecret()),
    );
    expect(secrets.size).toBe(50);
  });
});

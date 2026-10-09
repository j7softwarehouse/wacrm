import { beforeEach, describe, expect, it, vi } from "vitest";

const limit = vi.fn();
const select = vi.fn(() => ({ limit }));
const from = vi.fn(() => ({ select }));

vi.mock("@/lib/flows/admin-client", () => ({
  supabaseAdmin: () => ({ from }),
}));

const { GET } = await import("./route");

// Monitor externo (UptimeRobot) consulta esta rota. Ela precisa falhar
// quando o banco não responde — o Supabase do plano grátis pausa sozinho,
// e checar só a página de login não pegaria isso.
describe("GET /api/health", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("200 quando o banco responde", async () => {
    limit.mockResolvedValue({ data: [{ id: "a1" }], error: null });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(from).toHaveBeenCalledWith("accounts");
    expect(select).toHaveBeenCalledWith("id");
    expect(limit).toHaveBeenCalledWith(1);
  });

  it("503 quando o banco devolve erro", async () => {
    limit.mockResolvedValue({ data: null, error: { message: "paused" } });
    const res = await GET();
    expect(res.status).toBe(503);
    expect((await res.json()).ok).toBe(false);
  });

  it("503 quando a consulta lança exceção (timeout/rede)", async () => {
    limit.mockRejectedValue(new Error("fetch failed"));
    const res = await GET();
    expect(res.status).toBe(503);
    expect((await res.json()).ok).toBe(false);
  });
});

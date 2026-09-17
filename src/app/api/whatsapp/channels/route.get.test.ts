import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentAccount: vi.fn(),
}));

vi.mock("@/lib/auth/account", () => ({
  getCurrentAccount: mocks.getCurrentAccount,
  toErrorResponse: (err: unknown) =>
    Response.json(
      { error: err instanceof Error ? err.message : "unknown" },
      { status: 500 },
    ),
}));

const { GET } = await import("./route");

const CHANNEL_ROWS = [
  { id: "chan-a", account_id: "acc-1", provider: "uazapi", label: "Geral", phone_e164: "5511111111111", status: "connected" },
  { id: "chan-b", account_id: "acc-1", provider: "uazapi", label: "Financeiro", phone_e164: "5511222222222", status: "connected" },
];

describe("GET /api/whatsapp/channels", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Stub Supabase's `.from(table)` chain, dispatching by table name so
  // each of the three tables this route touches (whatsapp_channels,
  // profiles, channel_members) returns its own fixture.
  function stubSupabase(opts: {
    channelScope?: string;
    memberChannelIds?: string[];
  }) {
    return {
      from: (table: string) => {
        if (table === "whatsapp_channels") {
          return {
            select: () => ({
              eq: () => ({
                order: () => Promise.resolve({ data: CHANNEL_ROWS, error: null }),
              }),
            }),
          };
        }
        if (table === "profiles") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: { channel_scope: opts.channelScope ?? "all" },
                    error: null,
                  }),
              }),
            }),
          };
        }
        if (table === "channel_members") {
          return {
            select: () => ({
              eq: () =>
                Promise.resolve({
                  data: (opts.memberChannelIds ?? []).map((channel_id) => ({ channel_id })),
                  error: null,
                }),
            }),
          };
        }
        throw new Error(`unexpected table: ${table}`);
      },
    };
  }

  it("admin vê todos os canais, mesmo sem checar channel_scope", async () => {
    mocks.getCurrentAccount.mockResolvedValue({
      supabase: stubSupabase({}),
      userId: "user-1",
      accountId: "acc-1",
      role: "admin",
    });

    const res = await GET();
    const json = await res.json();
    expect(json.channels.map((c: { id: string }) => c.id)).toEqual(["chan-a", "chan-b"]);
  });

  it("agent com channel_scope 'all' vê todos os canais", async () => {
    mocks.getCurrentAccount.mockResolvedValue({
      supabase: stubSupabase({ channelScope: "all" }),
      userId: "user-2",
      accountId: "acc-1",
      role: "agent",
    });

    const res = await GET();
    const json = await res.json();
    expect(json.channels.map((c: { id: string }) => c.id)).toEqual(["chan-a", "chan-b"]);
  });

  it("agent com channel_scope 'assigned' só vê os canais que atende", async () => {
    mocks.getCurrentAccount.mockResolvedValue({
      supabase: stubSupabase({ channelScope: "assigned", memberChannelIds: ["chan-b"] }),
      userId: "user-3",
      accountId: "acc-1",
      role: "agent",
    });

    const res = await GET();
    const json = await res.json();
    expect(json.channels.map((c: { id: string }) => c.id)).toEqual(["chan-b"]);
  });

  it("agent restrito sem nenhum canal atribuído vê lista vazia, não todos os canais", async () => {
    mocks.getCurrentAccount.mockResolvedValue({
      supabase: stubSupabase({ channelScope: "assigned", memberChannelIds: [] }),
      userId: "user-4",
      accountId: "acc-1",
      role: "viewer",
    });

    const res = await GET();
    const json = await res.json();
    expect(json.channels).toEqual([]);
  });
});

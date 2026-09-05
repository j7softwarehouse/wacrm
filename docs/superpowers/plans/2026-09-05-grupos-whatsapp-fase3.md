# Grupos de WhatsApp — Fase 3 (gestão de grupo) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sair do grupo, adicionar/remover/promover/rebaixar participante e renomear grupo, tudo pelo CRM, refletindo de verdade no WhatsApp.

**Architecture:** Três rotas de API novas de propósito único (`leave`, `participants`, `name`), cada uma chamando um método novo do provider uazapi (inexistente no provider Meta). Uma coluna nova (`left_at`) marca quando o número saiu de verdade, bloqueando envio nesse caso. A tela de gestão em Configurações → Grupos busca participantes e status de admin ao vivo, nunca de cache local.

**Tech Stack:** Next.js App Router, TypeScript, Supabase (Postgres + RLS), Vitest, uazapi (provider WhatsApp).

**Spec:** `docs/superpowers/specs/2026-09-04-grupos-whatsapp-fase3-design.md`

## Global Constraints

- Participante de grupo nunca vira `contact` — nenhuma tarefa cria, atualiza ou apaga linha em `contacts`.
- `shouldDispatchEngines` (`src/lib/whatsapp/inbound/ingest.ts`) permanece intocada — nenhuma tarefa toca esse arquivo.
- Só admin da conta (`canEditSettings`, `hasMinRole(role, "admin")`) pode acionar as três rotas de escrita novas (`leave`, `POST .../participants`, `POST .../name`). `GET .../participants` não exige admin.
- `POST /group/leave` da uazapi sempre responde sucesso mesmo sem efeito — nenhuma rota confia nisso sem reconfirmar via `provider.listGroups()`/`provider.getGroupParticipants()`.
- `POST /group/updateParticipants` da uazapi responde HTTP 200 mesmo quando a ação falhou — o resultado real vem em `groupUpdated[].Error` (`0` = sucesso). O provider sempre lança se `Error !== 0`, nunca deixa a rota achar que deu certo por status HTTP sozinho.
- Sem migration além da coluna `left_at` (uma linha, idempotente com `IF NOT EXISTS`).
- Comentários e mensagens de commit em português.
- Suíte completa (`npx vitest run`) antes de cada commit — 1:1 e Fases 1/2 não podem regredir. Baseline conhecido: 872 passed, 5 falhas pré-existentes de locale/timezone (`currency.test.ts`, `dashboard/date-utils.test.ts`), não relacionadas.
- Colar saída REAL de `npx tsc --noEmit`, nunca parafrasear.

---

### Task 1: Provider — cinco métodos novos (uazapi real, Meta recusa)

**Files:**
- Modify: `src/lib/whatsapp/providers/types.ts`
- Modify: `src/lib/whatsapp/providers/uazapi.ts`
- Modify: `src/lib/whatsapp/providers/meta.ts`
- Test: `src/lib/whatsapp/providers/uazapi.test.ts`
- Test: `src/lib/whatsapp/providers/meta.test.ts`

**Interfaces:**
- Produces: `WhatsAppProvider.leaveGroup(groupJid: string): Promise<void>`, `WhatsAppProvider.updateGroupParticipants(args: UpdateGroupParticipantsArgs): Promise<void>`, `WhatsAppProvider.updateGroupName(groupJid: string, name: string): Promise<void>`, `WhatsAppProvider.getConnectedNumber(): Promise<string>`, `WhatsAppProvider.getGroupParticipants(groupJid: string): Promise<GroupParticipant[]>`. Todos consumidos pelas Tarefas 3, 4 e 5.

- [ ] **Step 1: Escrever os testes que falham, em `uazapi.test.ts`**

Acrescentar ao final do arquivo (dentro do `describe("createUazapiProvider", ...)` existente, depois do último `it`):

```ts
  it("sai do grupo via POST /group/leave", async () => {
    post.mockResolvedValueOnce({ response: "Group leave successful" });
    const provider = createUazapiProvider(config);
    await provider.leaveGroup("120363429748080632@g.us");
    expect(post).toHaveBeenCalledWith("/group/leave", {
      groupjid: "120363429748080632@g.us",
    });
  });

  it("atualiza participante via POST /group/updateParticipants quando Error=0", async () => {
    post.mockResolvedValueOnce({
      group: {},
      groupUpdated: [
        { PhoneNumber: "5511999999999@s.whatsapp.net", IsAdmin: false, Error: 0 },
      ],
      needs_refresh: false,
    });
    const provider = createUazapiProvider(config);
    await provider.updateGroupParticipants({
      groupJid: "120363429748080632@g.us",
      action: "add",
      phone: "5511999999999",
    });
    expect(post).toHaveBeenCalledWith("/group/updateParticipants", {
      groupjid: "120363429748080632@g.us",
      action: "add",
      participants: ["5511999999999"],
    });
  });

  it("lança quando updateParticipants devolve Error != 0 mesmo com HTTP 200", async () => {
    // Achado empírico (spec §1): a uazapi responde 200 mesmo quando a
    // ação falhou -- o resultado real vem aninhado por telefone.
    post.mockResolvedValueOnce({
      group: {},
      groupUpdated: [
        { PhoneNumber: "553183839660@s.whatsapp.net", IsAdmin: true, Error: 409 },
      ],
      needs_refresh: false,
    });
    const provider = createUazapiProvider(config);
    await expect(
      provider.updateGroupParticipants({
        groupJid: "120363429748080632@g.us",
        action: "add",
        phone: "553183839660",
      }),
    ).rejects.toThrow(/409/);
  });

  it("lança quando updateParticipants nao devolve entrada para o telefone enviado", async () => {
    post.mockResolvedValueOnce({ group: {}, groupUpdated: [], needs_refresh: false });
    const provider = createUazapiProvider(config);
    await expect(
      provider.updateGroupParticipants({
        groupJid: "120363429748080632@g.us",
        action: "remove",
        phone: "5511999999999",
      }),
    ).rejects.toThrow();
  });

  it("renomeia grupo via POST /group/updateName", async () => {
    post.mockResolvedValueOnce({});
    const provider = createUazapiProvider(config);
    await provider.updateGroupName("120363429748080632@g.us", "Novo Nome");
    expect(post).toHaveBeenCalledWith("/group/updateName", {
      groupjid: "120363429748080632@g.us",
      name: "Novo Nome",
    });
  });

  it("lê o número conectado via GET /instance/status", async () => {
    get.mockResolvedValueOnce({ instance: { owner: "553183886076" } });
    const provider = createUazapiProvider(config);
    await expect(provider.getConnectedNumber()).resolves.toBe("553183886076");
    expect(get).toHaveBeenCalledWith("/instance/status");
  });

  it("lança quando /instance/status nao devolve owner", async () => {
    get.mockResolvedValueOnce({ instance: {} });
    const provider = createUazapiProvider(config);
    await expect(provider.getConnectedNumber()).rejects.toThrow();
  });

  it("lê participantes de um grupo via GET /group/list, filtrando pelo JID", async () => {
    get.mockResolvedValueOnce({
      groups: [
        {
          JID: "outro@g.us",
          Name: "Outro",
          Participants: [{ PhoneNumber: "5500000000000@s.whatsapp.net", IsAdmin: true }],
        },
        {
          JID: "120363429748080632@g.us",
          Name: "Teste",
          Participants: [
            { PhoneNumber: "553183886076@s.whatsapp.net", IsAdmin: false },
            { PhoneNumber: "553183839660@s.whatsapp.net", IsAdmin: true },
          ],
        },
      ],
    });
    const provider = createUazapiProvider(config);
    const result = await provider.getGroupParticipants("120363429748080632@g.us");
    expect(result).toEqual([
      { phoneNumber: "553183886076", isAdmin: false },
      { phoneNumber: "553183839660", isAdmin: true },
    ]);
  });

  it("lança quando getGroupParticipants nao acha o grupo na lista", async () => {
    get.mockResolvedValueOnce({ groups: [] });
    const provider = createUazapiProvider(config);
    await expect(
      provider.getGroupParticipants("nao-existe@g.us"),
    ).rejects.toThrow();
  });
```

- [ ] **Step 2: Rodar e confirmar que falham**

Run: `npx vitest run src/lib/whatsapp/providers/uazapi.test.ts`
Expected: FAIL — `provider.leaveGroup is not a function` (e os demais métodos novos, um a um conforme os testes rodam).

- [ ] **Step 3: Acrescentar os tipos em `types.ts`**

No topo do arquivo, junto das outras interfaces de argumento (ex.: depois de `SendTemplateArgs`):

```ts
export interface UpdateGroupParticipantsArgs {
  groupJid: string;
  action: "add" | "remove" | "promote" | "demote";
  phone: string;
}

export interface GroupParticipant {
  /** Sem `+`, sem sufixo — mesmo formato aceito por `participants` em `updateGroupParticipants`. */
  phoneNumber: string;
  isAdmin: boolean;
}
```

Dentro de `WhatsAppProvider`, logo depois de `listGroups(...)`:

```ts
  /** Remove o número conectado do grupo. A UAZAPI não confirma efeito
   *  real (ver `leaveGroup` do provider uazapi) — o chamador reconfirma. */
  leaveGroup(groupJid: string): Promise<void>;
  /** Adiciona/remove/promove/rebaixa um participante. Lança se a ação
   *  falhar, mesmo que o provider upstream responda HTTP 200. */
  updateGroupParticipants(args: UpdateGroupParticipantsArgs): Promise<void>;
  /** Renomeia o grupo no WhatsApp real. */
  updateGroupName(groupJid: string, name: string): Promise<void>;
  /** Número do WhatsApp conectado (ex.: "553183886076"), para comparar
   *  contra `phoneNumber` de cada participante e saber se é admin. */
  getConnectedNumber(): Promise<string>;
  /** Participantes de UM grupo, com status de admin. */
  getGroupParticipants(groupJid: string): Promise<GroupParticipant[]>;
```

- [ ] **Step 4: Implementar em `uazapi.ts`**

No topo do arquivo, o import existente de `"./types"` já traz vários tipos com `type X` — acrescentar `type UpdateGroupParticipantsArgs` e `type GroupParticipant` a essa mesma lista:

```ts
import {
  ProviderUnsupportedError,
  type GroupParticipant,
  type SendInteractiveButtonsArgs,
  type SendInteractiveListArgs,
  type SendMediaArgs,
  type SendReactionArgs,
  type SendResult,
  type SendTextArgs,
  type UpdateGroupParticipantsArgs,
  type WhatsAppProvider,
} from "./types";
```

Estender a interface existente `UazapiGroup` (por volta da linha 52):

```ts
interface UazapiGroup {
  JID: string;
  Name?: string;
  Participants?: Array<{ PhoneNumber?: string; IsAdmin?: boolean }>;
}
```

Acrescentar, antes da chave de fechamento do objeto retornado por `createUazapiProvider` (logo depois de `listGroups`, dentro do mesmo `return { ... }`):

```ts
    async leaveGroup(groupJid: string): Promise<void> {
      // Sem retorno útil — a UAZAPI responde "successful" mesmo se nada
      // mudou (confirmado empiricamente contra a instância real — ver
      // spec da Fase 3, seção 1). O chamador confirma via
      // listGroups()/getGroupParticipants() antes de considerar a
      // saída bem-sucedida.
      await client.post("/group/leave", { groupjid: groupJid });
    },

    async updateGroupParticipants(
      args: UpdateGroupParticipantsArgs,
    ): Promise<void> {
      const result = await client.post<UazapiUpdateParticipantsResponse>(
        "/group/updateParticipants",
        {
          groupjid: args.groupJid,
          action: args.action,
          participants: [args.phone],
        },
      );
      // HTTP 200 não significa sucesso — confirmado empiricamente: o
      // resultado real vem aninhado por telefone. Casa por
      // PhoneNumber (que começa com o telefone enviado) em vez de
      // pegar o primeiro item às cegas.
      const entry = result.groupUpdated?.find((p) =>
        p.PhoneNumber?.startsWith(args.phone),
      );
      if (!entry || entry.Error !== 0) {
        throw new Error(
          `uazapi recusou a ação "${args.action}" para ${args.phone} (Error: ${entry?.Error ?? "ausente"})`,
        );
      }
    },

    async updateGroupName(groupJid: string, name: string): Promise<void> {
      await client.post("/group/updateName", { groupjid: groupJid, name });
    },

    async getConnectedNumber(): Promise<string> {
      const status = await client.get<{ instance?: { owner?: string } }>(
        "/instance/status",
      );
      if (!status.instance?.owner) {
        throw new Error("uazapi não devolveu o número do WhatsApp conectado.");
      }
      return status.instance.owner;
    },

    async getGroupParticipants(
      groupJid: string,
    ): Promise<GroupParticipant[]> {
      // Mesmo endpoint de listGroups(), mas este método lê o campo
      // Participants que listGroups() descarta deliberadamente (ver
      // comentário em UazapiGroup) — método próprio para não misturar
      // responsabilidades com o contrato leve já testado de
      // listGroups().
      const response = await client.get<UazapiGroupListResponse>("/group/list");
      const group = response.groups.find((g) => g.JID === groupJid);
      if (!group) {
        throw new Error(`Grupo ${groupJid} não encontrado na lista da uazapi.`);
      }
      return (group.Participants ?? []).map((p) => ({
        phoneNumber: (p.PhoneNumber ?? "").replace("@s.whatsapp.net", ""),
        isAdmin: !!p.IsAdmin,
      }));
    },
```

Acrescentar a interface de resposta nova, junto de `UazapiGroupListResponse`:

```ts
interface UazapiUpdateParticipantsResponse {
  groupUpdated?: Array<{
    PhoneNumber?: string;
    IsAdmin?: boolean;
    /** 0 = sucesso; qualquer outro valor = falha (ex.: 409 = já é participante). */
    Error: number;
  }>;
}
```

- [ ] **Step 5: Rodar e confirmar que os testes de `uazapi.test.ts` passam**

Run: `npx vitest run src/lib/whatsapp/providers/uazapi.test.ts`
Expected: PASS — todos os testes (os pré-existentes de `listGroups` e os novos desta tarefa).

- [ ] **Step 6: Meta recusa os cinco métodos — teste primeiro**

Ler `meta.test.ts` para achar o teste existente que confirma `listGroups()` lançando `ProviderUnsupportedError` (padrão a seguir). Acrescentar, no mesmo `describe`:

```ts
  it("recusa leaveGroup, updateGroupParticipants, updateGroupName, getConnectedNumber e getGroupParticipants", async () => {
    const provider = createMetaProvider(config);
    await expect(provider.leaveGroup("x@g.us")).rejects.toBeInstanceOf(
      ProviderUnsupportedError,
    );
    await expect(
      provider.updateGroupParticipants({ groupJid: "x@g.us", action: "add", phone: "1" }),
    ).rejects.toBeInstanceOf(ProviderUnsupportedError);
    await expect(
      provider.updateGroupName("x@g.us", "Nome"),
    ).rejects.toBeInstanceOf(ProviderUnsupportedError);
    await expect(provider.getConnectedNumber()).rejects.toBeInstanceOf(
      ProviderUnsupportedError,
    );
    await expect(
      provider.getGroupParticipants("x@g.us"),
    ).rejects.toBeInstanceOf(ProviderUnsupportedError);
  });
```

(Ajustar `createMetaProvider`/`config`/imports para bater exatamente com o que `meta.test.ts` já usa nos testes vizinhos — não inventar nomes novos.)

- [ ] **Step 7: Rodar e confirmar que falha, depois implementar em `meta.ts`**

Run: `npx vitest run src/lib/whatsapp/providers/meta.test.ts`
Expected: FAIL — método não existe.

No topo do arquivo, acrescentar `type GroupParticipant` ao import já existente de `"./types"`:

```ts
import {
  ProviderUnsupportedError,
  type GroupParticipant,
  type SendInteractiveButtonsArgs,
  type SendInteractiveListArgs,
  type SendMediaArgs,
  type SendReactionArgs,
  type SendResult,
  type SendTemplateArgs,
  type SendTextArgs,
  type WhatsAppProvider,
} from "./types";
```

No objeto retornado por `createMetaProvider` (mesmo padrão do `listGroups` existente, por volta da linha 121):

```ts
    async leaveGroup(): Promise<void> {
      throw new ProviderUnsupportedError("meta", "leaveGroup");
    },
    async updateGroupParticipants(): Promise<void> {
      throw new ProviderUnsupportedError("meta", "updateGroupParticipants");
    },
    async updateGroupName(): Promise<void> {
      throw new ProviderUnsupportedError("meta", "updateGroupName");
    },
    async getConnectedNumber(): Promise<string> {
      throw new ProviderUnsupportedError("meta", "getConnectedNumber");
    },
    async getGroupParticipants(): Promise<GroupParticipant[]> {
      throw new ProviderUnsupportedError("meta", "getGroupParticipants");
    },
```

Run: `npx vitest run src/lib/whatsapp/providers/meta.test.ts`
Expected: PASS.

- [ ] **Step 8: Typecheck + suíte completa**

Run: `npx tsc --noEmit` — colar saída real.
Run: `npx vitest run` — confirmar 872+11 (ou o total exato após esta tarefa) passed, mesmas 5 falhas pré-existentes.

- [ ] **Step 9: Commit**

```bash
git add src/lib/whatsapp/providers/types.ts src/lib/whatsapp/providers/uazapi.ts src/lib/whatsapp/providers/meta.ts src/lib/whatsapp/providers/uazapi.test.ts src/lib/whatsapp/providers/meta.test.ts
git commit -m "feat(grupos): provider ganha sair/gerenciar participantes/renomear grupo"
```

---

### Task 2: Migration `left_at` + `GET /api/whatsapp/groups` expõe a coluna

**Files:**
- Create: `supabase/migrations/20260905000001_group_left_at.sql`
- Modify: `src/app/api/whatsapp/groups/route.ts`
- Test: `src/app/api/whatsapp/groups/route.test.ts`

**Interfaces:**
- Produces: coluna `whatsapp_groups.left_at TIMESTAMPTZ`, consumida pelas Tarefas 3, 4, 5, 6 e 7.

- [ ] **Step 1: Criar a migration**

```sql
-- ============================================================
-- 20260905000001_group_left_at
--
-- Fase 3: distingue "o número conectado saiu de verdade deste
-- grupo" (left_at preenchido) de "o usuário só desabilitou a
-- exibição, mas ainda é membro" (enabled = false, left_at nulo).
-- ============================================================
ALTER TABLE whatsapp_groups
  ADD COLUMN IF NOT EXISTS left_at TIMESTAMPTZ;
```

- [ ] **Step 2: Escrever o teste que falha para o GET incluir `left_at`**

Em `route.test.ts`, no `describe('GET /api/whatsapp/groups', ...)`, acrescentar:

```ts
  it('inclui left_at na resposta', async () => {
    mocks.createClient.mockResolvedValue(
      comSessao([{ id: 'g-1', group_jid: '1@g.us', name: 'Turma', enabled: false, left_at: '2026-09-05T00:00:00Z' }]),
    );

    const res = await GET(new Request('https://x/api/whatsapp/groups'));
    const body = await res.json();

    expect(body.groups[0].left_at).toBe('2026-09-05T00:00:00Z');
  });
```

- [ ] **Step 3: Rodar e confirmar que falha**

Run: `npx vitest run src/app/api/whatsapp/groups/route.test.ts -t "inclui left_at"`
Expected: FAIL — `body.groups[0].left_at` é `undefined` (o `.select()` da rota não pede a coluna).

- [ ] **Step 4: Acrescentar `left_at` ao `.select()` do GET**

Em `route.ts`, linha do `.select("id, group_jid, name, avatar_url, enabled")` dentro do `GET`, trocar por:

```ts
      .select("id, group_jid, name, avatar_url, enabled, left_at")
```

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `npx vitest run src/app/api/whatsapp/groups/route.test.ts`
Expected: PASS — todos os testes do arquivo, incluindo o novo.

- [ ] **Step 6: Suíte completa + typecheck**

Run: `npx vitest run` e `npx tsc --noEmit` — colar saída real de cada um.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260905000001_group_left_at.sql src/app/api/whatsapp/groups/route.ts src/app/api/whatsapp/groups/route.test.ts
git commit -m "feat(grupos): coluna left_at distingue saida real de desabilitado"
```

---

### Task 3: `POST /api/whatsapp/groups/[id]/leave`

**Files:**
- Create: `src/app/api/whatsapp/groups/[id]/leave/route.ts`
- Test: `src/app/api/whatsapp/groups/[id]/leave/route.test.ts`

**Interfaces:**
- Consumes: `provider.leaveGroup(groupJid)`, `provider.listGroups()` (Tarefa 1); `getProviderForChannel(db, channelId)` (`@/lib/whatsapp/providers/resolve`, já existente); `canEditSettings(role)` (`@/lib/auth/roles`, já existente).
- Produces: `POST /api/whatsapp/groups/[id]/leave` → `200 { left: true }` em sucesso.

- [ ] **Step 1: Escrever os testes que falham**

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getProviderForChannel: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));
vi.mock('@/lib/whatsapp/providers/resolve', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/whatsapp/providers/resolve')>();
  return { ...actual, getProviderForChannel: mocks.getProviderForChannel };
});

import { POST } from './route';

function comSessao(role: string, grupo: Record<string, unknown> | null) {
  return {
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }) },
    from: (table: string) => {
      if (table === 'profiles') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { account_id: 'acct-1', account_role: role },
                error: null,
              }),
            }),
          }),
        };
      }
      // whatsapp_groups
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: grupo, error: null }),
        update: () => ({ eq: async () => ({ error: null }) }),
      };
      return chain;
    },
  };
}

function request() {
  return new Request('https://x/api/whatsapp/groups/g-1/leave', { method: 'POST' });
}
const params = Promise.resolve({ id: 'g-1' });

describe('POST /api/whatsapp/groups/[id]/leave', () => {
  beforeEach(() => vi.clearAllMocks());

  it('devolve 401 sem sessao', async () => {
    mocks.createClient.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    });
    const res = await POST(request(), { params });
    expect(res.status).toBe(401);
  });

  it('devolve 403 quando o chamador nao e admin', async () => {
    mocks.createClient.mockResolvedValue(
      comSessao('agent', { id: 'g-1', account_id: 'acct-1', channel_id: 'chan-1', group_jid: '1@g.us' }),
    );
    const res = await POST(request(), { params });
    expect(res.status).toBe(403);
  });

  it('devolve 404 quando o grupo nao pertence a conta', async () => {
    mocks.createClient.mockResolvedValue(comSessao('admin', null));
    const res = await POST(request(), { params });
    expect(res.status).toBe(404);
  });

  it('sai do grupo e confirma via listGroups antes de marcar left_at', async () => {
    mocks.createClient.mockResolvedValue(
      comSessao('admin', { id: 'g-1', account_id: 'acct-1', channel_id: 'chan-1', group_jid: '1@g.us' }),
    );
    const leaveGroup = vi.fn(async () => {});
    const listGroups = vi.fn(async () => []); // grupo sumiu -- confirma saida
    mocks.getProviderForChannel.mockResolvedValue({ leaveGroup, listGroups });

    const res = await POST(request(), { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.left).toBe(true);
    expect(leaveGroup).toHaveBeenCalledWith('1@g.us');
    expect(listGroups).toHaveBeenCalled();
  });

  it('devolve erro claro quando a uazapi diz sucesso mas o grupo continua na lista', async () => {
    // Achado empirico (spec Fase 3): /group/leave sempre "successful",
    // mesmo sem efeito. A rota nao pode confiar nisso.
    mocks.createClient.mockResolvedValue(
      comSessao('admin', { id: 'g-1', account_id: 'acct-1', channel_id: 'chan-1', group_jid: '1@g.us' }),
    );
    const leaveGroup = vi.fn(async () => {});
    const listGroups = vi.fn(async () => [{ groupJid: '1@g.us', name: 'Teste' }]); // ainda la
    mocks.getProviderForChannel.mockResolvedValue({ leaveGroup, listGroups });

    const res = await POST(request(), { params });

    expect(res.status).toBe(502);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falham**

Run: `npx vitest run src/app/api/whatsapp/groups/[id]/leave/route.test.ts`
Expected: FAIL — arquivo `route.ts` não existe.

- [ ] **Step 3: Implementar a rota**

```ts
import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { canEditSettings, isAccountRole, type AccountRole } from "@/lib/auth/roles";
import { getProviderForChannel } from "@/lib/whatsapp/providers/resolve";

// ============================================================
// POST /api/whatsapp/groups/[id]/leave — remove o número conectado
// de um grupo real.
//
// A UAZAPI sempre responde sucesso em POST /group/leave, mesmo sem
// efeito (confirmado empiricamente durante a investigação da Fase 3 —
// um incidente real aconteceu por confiar nessa resposta). Por isso
// esta rota reconfirma via listGroups() antes de gravar left_at.
// ============================================================

type GroupsSupabase = Awaited<ReturnType<typeof createClient>>;

interface CallerProfile {
  accountId: string;
  role: AccountRole | null;
}

async function resolveCallerProfile(
  supabase: GroupsSupabase,
  userId: string,
): Promise<CallerProfile | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("account_id, account_role")
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !data?.account_id) return null;

  return {
    accountId: data.account_id as string,
    role: isAccountRole(data.account_role) ? data.account_role : null,
  };
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const profile = await resolveCallerProfile(supabase, user.id);
    if (!profile) {
      return NextResponse.json(
        { error: "Your profile is not linked to an account." },
        { status: 403 },
      );
    }

    if (!profile.role || !canEditSettings(profile.role)) {
      return NextResponse.json(
        { error: "Only account admins can remove the group." },
        { status: 403 },
      );
    }

    const { data: group, error: groupErr } = await supabase
      .from("whatsapp_groups")
      .select("id, channel_id, group_jid")
      .eq("id", id)
      .eq("account_id", profile.accountId)
      .maybeSingle();

    if (groupErr || !group) {
      return NextResponse.json({ error: "Group not found" }, { status: 404 });
    }

    const provider = await getProviderForChannel(supabase, group.channel_id as string);

    await provider.leaveGroup(group.group_jid as string);

    const remaining = await provider.listGroups();
    const stillThere = remaining.some((g) => g.groupJid === group.group_jid);
    if (stillThere) {
      return NextResponse.json(
        {
          error:
            "A uazapi respondeu sucesso mas o grupo continua na lista — tente novamente",
        },
        { status: 502 },
      );
    }

    const { error: updateErr } = await supabase
      .from("whatsapp_groups")
      .update({ left_at: new Date().toISOString(), enabled: false })
      .eq("id", id);

    if (updateErr) {
      console.error("[POST .../leave] update error:", updateErr.message);
      return NextResponse.json({ error: "Failed to record leave" }, { status: 500 });
    }

    return NextResponse.json({ left: true });
  } catch (err) {
    console.error("Error in POST /api/whatsapp/groups/[id]/leave:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
```

- [ ] **Step 4: Rodar e confirmar que passam**

Run: `npx vitest run src/app/api/whatsapp/groups/[id]/leave/route.test.ts`
Expected: PASS — todos os 5 testes.

- [ ] **Step 5: Suíte completa + typecheck**

Run: `npx vitest run` e `npx tsc --noEmit` — colar saída real.

- [ ] **Step 6: Commit**

```bash
git add "src/app/api/whatsapp/groups/[id]/leave/route.ts" "src/app/api/whatsapp/groups/[id]/leave/route.test.ts"
git commit -m "feat(grupos): rota para sair do grupo, com reconfirmacao via listGroups"
```

---

### Task 4: `GET`/`POST /api/whatsapp/groups/[id]/participants`

**Files:**
- Create: `src/app/api/whatsapp/groups/[id]/participants/route.ts`
- Test: `src/app/api/whatsapp/groups/[id]/participants/route.test.ts`

**Interfaces:**
- Consumes: `provider.getGroupParticipants(groupJid)`, `provider.getConnectedNumber()`, `provider.updateGroupParticipants(args)` (Tarefa 1).
- Produces: `GET` → `200 { participants: GroupParticipant[], isConnectedNumberAdmin: boolean }`; `POST` → `200 { participants: GroupParticipant[] }`.

- [ ] **Step 1: Escrever os testes que falham**

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getProviderForChannel: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));
vi.mock('@/lib/whatsapp/providers/resolve', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/whatsapp/providers/resolve')>();
  return { ...actual, getProviderForChannel: mocks.getProviderForChannel };
});

import { GET, POST } from './route';

function comSessao(role: string, grupo: Record<string, unknown> | null) {
  return {
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }) },
    from: (table: string) => {
      if (table === 'profiles') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { account_id: 'acct-1', account_role: role },
                error: null,
              }),
            }),
          }),
        };
      }
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: grupo, error: null }),
      };
      return chain;
    },
  };
}

const params = Promise.resolve({ id: 'g-1' });
const grupoBase = { id: 'g-1', account_id: 'acct-1', channel_id: 'chan-1', group_jid: '1@g.us', left_at: null };

describe('GET /api/whatsapp/groups/[id]/participants', () => {
  beforeEach(() => vi.clearAllMocks());

  it('devolve 401 sem sessao', async () => {
    mocks.createClient.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    });
    const res = await GET(new Request('https://x'), { params });
    expect(res.status).toBe(401);
  });

  it('nao exige admin para ler', async () => {
    mocks.createClient.mockResolvedValue(comSessao('viewer', grupoBase));
    mocks.getProviderForChannel.mockResolvedValue({
      getGroupParticipants: async () => [
        { phoneNumber: '553183886076', isAdmin: false },
        { phoneNumber: '553183839660', isAdmin: true },
      ],
      getConnectedNumber: async () => '553183886076',
    });

    const res = await GET(new Request('https://x'), { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.participants).toHaveLength(2);
    expect(body.isConnectedNumberAdmin).toBe(false);
  });

  it('isConnectedNumberAdmin=true quando o numero conectado e admin', async () => {
    mocks.createClient.mockResolvedValue(comSessao('viewer', grupoBase));
    mocks.getProviderForChannel.mockResolvedValue({
      getGroupParticipants: async () => [{ phoneNumber: '553183886076', isAdmin: true }],
      getConnectedNumber: async () => '553183886076',
    });

    const res = await GET(new Request('https://x'), { params });
    const body = await res.json();

    expect(body.isConnectedNumberAdmin).toBe(true);
  });

  it('devolve 404 quando o grupo ja foi deixado (left_at preenchido)', async () => {
    mocks.createClient.mockResolvedValue(
      comSessao('viewer', { ...grupoBase, left_at: '2026-09-05T00:00:00Z' }),
    );
    const res = await GET(new Request('https://x'), { params });
    expect(res.status).toBe(404);
  });
});

describe('POST /api/whatsapp/groups/[id]/participants', () => {
  beforeEach(() => vi.clearAllMocks());

  function request(body: unknown) {
    return new Request('https://x', { method: 'POST', body: JSON.stringify(body) });
  }

  it('devolve 403 quando o chamador nao e admin', async () => {
    mocks.createClient.mockResolvedValue(comSessao('agent', grupoBase));
    const res = await POST(request({ action: 'add', phone: '5511999999999' }), { params });
    expect(res.status).toBe(403);
  });

  it('devolve 400 para action invalida', async () => {
    mocks.createClient.mockResolvedValue(comSessao('admin', grupoBase));
    const res = await POST(request({ action: 'apagar', phone: '5511999999999' }), { params });
    expect(res.status).toBe(400);
  });

  it('devolve 400 sem phone', async () => {
    mocks.createClient.mockResolvedValue(comSessao('admin', grupoBase));
    const res = await POST(request({ action: 'add' }), { params });
    expect(res.status).toBe(400);
  });

  it('devolve 404 quando o grupo ja foi deixado', async () => {
    mocks.createClient.mockResolvedValue(
      comSessao('admin', { ...grupoBase, left_at: '2026-09-05T00:00:00Z' }),
    );
    const res = await POST(request({ action: 'add', phone: '5511999999999' }), { params });
    expect(res.status).toBe(404);
  });

  it('adiciona participante e devolve a lista atualizada', async () => {
    mocks.createClient.mockResolvedValue(comSessao('admin', grupoBase));
    const updateGroupParticipants = vi.fn(async () => {});
    const atualizados = [{ phoneNumber: '5511999999999', isAdmin: false }];
    mocks.getProviderForChannel.mockResolvedValue({
      updateGroupParticipants,
      getGroupParticipants: async () => atualizados,
    });

    const res = await POST(request({ action: 'add', phone: '5511999999999' }), { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(updateGroupParticipants).toHaveBeenCalledWith({
      groupJid: '1@g.us',
      action: 'add',
      phone: '5511999999999',
    });
    expect(body.participants).toEqual(atualizados);
  });

  it('propaga erro claro quando o provider lanca (ex.: Error != 0 da uazapi)', async () => {
    mocks.createClient.mockResolvedValue(comSessao('admin', grupoBase));
    mocks.getProviderForChannel.mockResolvedValue({
      updateGroupParticipants: vi.fn(async () => {
        throw new Error('uazapi recusou a ação "add" para 5511999999999 (Error: 409)');
      }),
      getGroupParticipants: async () => [],
    });

    const res = await POST(request({ action: 'add', phone: '5511999999999' }), { params });

    expect(res.status).toBe(502);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falham**

Run: `npx vitest run "src/app/api/whatsapp/groups/[id]/participants/route.test.ts"`
Expected: FAIL — arquivo `route.ts` não existe.

- [ ] **Step 3: Implementar a rota**

```ts
import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { canEditSettings, isAccountRole, type AccountRole } from "@/lib/auth/roles";
import { getProviderForChannel } from "@/lib/whatsapp/providers/resolve";

// ============================================================
// GET/POST /api/whatsapp/groups/[id]/participants
//
// GET: lista ao vivo (nunca cache local) + se o número conectado é
// admin. Não exige admin para ler.
//
// POST: add/remove/promote/demote, um telefone por vez. Exige admin.
// O provider já garante que Error != 0 (mesmo com HTTP 200 da uazapi)
// vira exceção — aqui só precisamos mapear pra HTTP.
// ============================================================

type GroupsSupabase = Awaited<ReturnType<typeof createClient>>;

interface CallerProfile {
  accountId: string;
  role: AccountRole | null;
}

async function resolveCallerProfile(
  supabase: GroupsSupabase,
  userId: string,
): Promise<CallerProfile | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("account_id, account_role")
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !data?.account_id) return null;

  return {
    accountId: data.account_id as string,
    role: isAccountRole(data.account_role) ? data.account_role : null,
  };
}

async function loadGroup(
  supabase: GroupsSupabase,
  id: string,
  accountId: string,
) {
  const { data, error } = await supabase
    .from("whatsapp_groups")
    .select("id, channel_id, group_jid, left_at")
    .eq("id", id)
    .eq("account_id", accountId)
    .maybeSingle();
  if (error || !data) return null;
  return data;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const profile = await resolveCallerProfile(supabase, user.id);
    if (!profile) {
      return NextResponse.json(
        { error: "Your profile is not linked to an account." },
        { status: 403 },
      );
    }

    const group = await loadGroup(supabase, id, profile.accountId);
    if (!group || group.left_at) {
      return NextResponse.json({ error: "Group not found" }, { status: 404 });
    }

    const provider = await getProviderForChannel(supabase, group.channel_id as string);
    const [participants, connectedNumber] = await Promise.all([
      provider.getGroupParticipants(group.group_jid as string),
      provider.getConnectedNumber(),
    ]);

    const me = participants.find((p) => p.phoneNumber === connectedNumber);

    return NextResponse.json({
      participants,
      isConnectedNumberAdmin: !!me?.isAdmin,
    });
  } catch (err) {
    console.error("Error in GET .../participants:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

interface PostBody {
  action?: string;
  phone?: string;
}

const VALID_ACTIONS = ["add", "remove", "promote", "demote"] as const;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const profile = await resolveCallerProfile(supabase, user.id);
    if (!profile) {
      return NextResponse.json(
        { error: "Your profile is not linked to an account." },
        { status: 403 },
      );
    }

    if (!profile.role || !canEditSettings(profile.role)) {
      return NextResponse.json(
        { error: "Only account admins can manage group participants." },
        { status: 403 },
      );
    }

    const body = (await request.json().catch(() => ({}))) as PostBody;
    const { action, phone } = body;

    if (!action || !VALID_ACTIONS.includes(action as (typeof VALID_ACTIONS)[number])) {
      return NextResponse.json(
        { error: `action must be one of: ${VALID_ACTIONS.join(", ")}` },
        { status: 400 },
      );
    }
    if (!phone) {
      return NextResponse.json({ error: "phone is required" }, { status: 400 });
    }

    const group = await loadGroup(supabase, id, profile.accountId);
    if (!group || group.left_at) {
      return NextResponse.json({ error: "Group not found" }, { status: 404 });
    }

    const provider = await getProviderForChannel(supabase, group.channel_id as string);

    try {
      await provider.updateGroupParticipants({
        groupJid: group.group_jid as string,
        action: action as "add" | "remove" | "promote" | "demote",
        phone,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown provider error";
      console.error("[POST .../participants] provider error:", message);
      return NextResponse.json({ error: message }, { status: 502 });
    }

    const participants = await provider.getGroupParticipants(group.group_jid as string);

    return NextResponse.json({ participants });
  } catch (err) {
    console.error("Error in POST .../participants:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
```

- [ ] **Step 4: Rodar e confirmar que passam**

Run: `npx vitest run "src/app/api/whatsapp/groups/[id]/participants/route.test.ts"`
Expected: PASS — todos os testes (4 do GET + 6 do POST).

- [ ] **Step 5: Suíte completa + typecheck**

Run: `npx vitest run` e `npx tsc --noEmit` — colar saída real.

- [ ] **Step 6: Commit**

```bash
git add "src/app/api/whatsapp/groups/[id]/participants/route.ts" "src/app/api/whatsapp/groups/[id]/participants/route.test.ts"
git commit -m "feat(grupos): rota GET/POST para gerenciar participantes"
```

---

### Task 5: `POST /api/whatsapp/groups/[id]/name`

**Files:**
- Create: `src/app/api/whatsapp/groups/[id]/name/route.ts`
- Test: `src/app/api/whatsapp/groups/[id]/name/route.test.ts`

**Interfaces:**
- Consumes: `provider.updateGroupName(groupJid, name)` (Tarefa 1).
- Produces: `POST /api/whatsapp/groups/[id]/name` → `200 { name }`.

- [ ] **Step 1: Escrever os testes que falham**

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getProviderForChannel: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));
vi.mock('@/lib/whatsapp/providers/resolve', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/whatsapp/providers/resolve')>();
  return { ...actual, getProviderForChannel: mocks.getProviderForChannel };
});

import { POST } from './route';

function comSessao(role: string, grupo: Record<string, unknown> | null, updatedRows: Record<string, unknown>[]) {
  return {
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }) },
    from: (table: string) => {
      if (table === 'profiles') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { account_id: 'acct-1', account_role: role },
                error: null,
              }),
            }),
          }),
        };
      }
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: grupo, error: null }),
        update: (row: Record<string, unknown>) => {
          updatedRows.push(row);
          return { eq: async () => ({ error: null }) };
        },
      };
      return chain;
    },
  };
}

const params = Promise.resolve({ id: 'g-1' });
const grupoBase = { id: 'g-1', account_id: 'acct-1', channel_id: 'chan-1', group_jid: '1@g.us', left_at: null };

function request(body: unknown) {
  return new Request('https://x', { method: 'POST', body: JSON.stringify(body) });
}

describe('POST /api/whatsapp/groups/[id]/name', () => {
  beforeEach(() => vi.clearAllMocks());

  it('devolve 403 quando o chamador nao e admin', async () => {
    mocks.createClient.mockResolvedValue(comSessao('agent', grupoBase, []));
    const res = await POST(request({ name: 'Novo Nome' }), { params });
    expect(res.status).toBe(403);
  });

  it('devolve 400 para nome vazio', async () => {
    mocks.createClient.mockResolvedValue(comSessao('admin', grupoBase, []));
    const res = await POST(request({ name: '   ' }), { params });
    expect(res.status).toBe(400);
  });

  it('devolve 404 quando o grupo ja foi deixado', async () => {
    mocks.createClient.mockResolvedValue(
      comSessao('admin', { ...grupoBase, left_at: '2026-09-05T00:00:00Z' }, []),
    );
    const res = await POST(request({ name: 'Novo Nome' }), { params });
    expect(res.status).toBe(404);
  });

  it('renomeia e grava localmente sem esperar sync', async () => {
    const updatedRows: Record<string, unknown>[] = [];
    mocks.createClient.mockResolvedValue(comSessao('admin', grupoBase, updatedRows));
    const updateGroupName = vi.fn(async () => {});
    mocks.getProviderForChannel.mockResolvedValue({ updateGroupName });

    const res = await POST(request({ name: 'Novo Nome' }), { params });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.name).toBe('Novo Nome');
    expect(updateGroupName).toHaveBeenCalledWith('1@g.us', 'Novo Nome');
    expect(updatedRows).toEqual([{ name: 'Novo Nome' }]);
  });

  it('propaga erro claro quando o provider lanca', async () => {
    mocks.createClient.mockResolvedValue(comSessao('admin', grupoBase, []));
    mocks.getProviderForChannel.mockResolvedValue({
      updateGroupName: vi.fn(async () => {
        throw new Error('Grupo não encontrado');
      }),
    });

    const res = await POST(request({ name: 'Novo Nome' }), { params });
    expect(res.status).toBe(502);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falham**

Run: `npx vitest run "src/app/api/whatsapp/groups/[id]/name/route.test.ts"`
Expected: FAIL — arquivo `route.ts` não existe.

- [ ] **Step 3: Implementar a rota**

```ts
import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { canEditSettings, isAccountRole, type AccountRole } from "@/lib/auth/roles";
import { getProviderForChannel } from "@/lib/whatsapp/providers/resolve";

type GroupsSupabase = Awaited<ReturnType<typeof createClient>>;

interface CallerProfile {
  accountId: string;
  role: AccountRole | null;
}

async function resolveCallerProfile(
  supabase: GroupsSupabase,
  userId: string,
): Promise<CallerProfile | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("account_id, account_role")
    .eq("user_id", userId)
    .maybeSingle();

  if (error || !data?.account_id) return null;

  return {
    accountId: data.account_id as string,
    role: isAccountRole(data.account_role) ? data.account_role : null,
  };
}

interface PostBody {
  name?: string;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const profile = await resolveCallerProfile(supabase, user.id);
    if (!profile) {
      return NextResponse.json(
        { error: "Your profile is not linked to an account." },
        { status: 403 },
      );
    }

    if (!profile.role || !canEditSettings(profile.role)) {
      return NextResponse.json(
        { error: "Only account admins can rename the group." },
        { status: 403 },
      );
    }

    const body = (await request.json().catch(() => ({}))) as PostBody;
    const name = body.name?.trim();
    if (!name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    const { data: group, error: groupErr } = await supabase
      .from("whatsapp_groups")
      .select("id, channel_id, group_jid, left_at")
      .eq("id", id)
      .eq("account_id", profile.accountId)
      .maybeSingle();

    if (groupErr || !group || group.left_at) {
      return NextResponse.json({ error: "Group not found" }, { status: 404 });
    }

    const provider = await getProviderForChannel(supabase, group.channel_id as string);

    try {
      await provider.updateGroupName(group.group_jid as string, name);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown provider error";
      console.error("[POST .../name] provider error:", message);
      return NextResponse.json({ error: message }, { status: 502 });
    }

    const { error: updateErr } = await supabase
      .from("whatsapp_groups")
      .update({ name })
      .eq("id", id);

    if (updateErr) {
      console.error("[POST .../name] update error:", updateErr.message);
      return NextResponse.json({ error: "Failed to save name locally" }, { status: 500 });
    }

    return NextResponse.json({ name });
  } catch (err) {
    console.error("Error in POST .../name:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
```

- [ ] **Step 4: Rodar e confirmar que passam**

Run: `npx vitest run "src/app/api/whatsapp/groups/[id]/name/route.test.ts"`
Expected: PASS — todos os 5 testes.

- [ ] **Step 5: Suíte completa + typecheck**

Run: `npx vitest run` e `npx tsc --noEmit` — colar saída real.

- [ ] **Step 6: Commit**

```bash
git add "src/app/api/whatsapp/groups/[id]/name/route.ts" "src/app/api/whatsapp/groups/[id]/name/route.test.ts"
git commit -m "feat(grupos): rota para renomear grupo, grava local sem esperar sync"
```

---

### Task 6: `sendMessageToConversation` recusa grupo que já saiu

**Files:**
- Modify: `src/lib/whatsapp/send-message.ts`
- Test: `src/lib/whatsapp/send-message.test.ts`

**Interfaces:**
- Consumes: coluna `whatsapp_groups.left_at` (Tarefa 2).

- [ ] **Step 1: Escrever o teste que falha**

No `describe('sendMessageToConversation — conversa de grupo', ...)` existente, usando o mesmo helper `groupDb` já presente no arquivo (ajustar o `group` embutido para incluir `left_at`):

```ts
  it('recusa envio quando o numero ja saiu do grupo (left_at preenchido)', async () => {
    const capture = { rows: [] as Record<string, unknown>[], tables: [] as string[] };
    const db = {
      from: (table: string) => {
        capture.tables.push(table);
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                single: async () => ({
                  data: {
                    id: 'cv-grupo',
                    account_id: 'acct-1',
                    contact_id: null,
                    group_id: 'grp-1',
                    contact: null,
                    group: { id: 'grp-1', group_jid: '120363000000000000@g.us', left_at: '2026-09-05T00:00:00Z' },
                  },
                  error: null,
                }),
                maybeSingle: async () => ({ data: null, error: null }),
              }),
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
          insert: (row: Record<string, unknown>) => {
            capture.rows.push(row);
            return { select: () => ({ single: async () => ({ data: { id: 'msg-1', ...row }, error: null }) }) };
          },
          update: () => ({ eq: async () => ({ error: null }) }),
        };
      },
    } as unknown as SupabaseClient;

    const err = await sendMessageToConversation(db, 'acct-1', {
      conversationId: 'cv-grupo',
      messageType: 'text',
      contentText: 'oi',
      senderUserId: 'user-1',
    }).catch((e) => e);

    expect(err).toBeInstanceOf(SendMessageError);
    expect((err as InstanceType<typeof SendMessageError>).code).toBe('bad_request');
    expect(capture.tables).not.toContain('contacts');
  });
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run src/lib/whatsapp/send-message.test.ts -t "left_at"`
Expected: FAIL — a mensagem tenta enviar normalmente (a função ainda não olha `left_at`), o teste não recebe `SendMessageError`.

- [ ] **Step 3: Acrescentar o guard em `send-message.ts`**

Trocar o tipo do `group` (por volta da linha 239, `const group = conversation.group as { group_jid?: string } | null;`) para incluir `left_at`:

```ts
  const group = conversation.group as { group_jid?: string; left_at?: string | null } | null;
```

E acrescentar o guard, logo depois do guard de interativo/template (Fase 2) dentro do `if (isGroupConversation) { ... }`:

```ts
    if (group?.left_at) {
      throw new SendMessageError(
        'bad_request',
        'You have left this group; sending is no longer possible',
        400
      );
    }
```

Atualizar o `.select()` da conversa (linha ~227) para embutir `left_at`:

```ts
    .select('*, contact:contacts(*), group:whatsapp_groups(id, group_jid, left_at)')
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run src/lib/whatsapp/send-message.test.ts`
Expected: PASS — todos os testes do arquivo (1:1, grupo existentes das Fases 1/2, e o novo).

- [ ] **Step 5: Suíte completa + typecheck**

Run: `npx vitest run` e `npx tsc --noEmit` — colar saída real.

- [ ] **Step 6: Commit**

```bash
git add src/lib/whatsapp/send-message.ts src/lib/whatsapp/send-message.test.ts
git commit -m "fix(grupos): recusa envio para grupo que o numero ja deixou"
```

---

### Task 7: UI — Configurações → Grupos ganha o painel de gestão

**Files:**
- Modify: `src/components/settings/groups-manager.tsx`
- Modify: `messages/pt.json`, `messages/en.json`, `messages/ko.json`

**Interfaces:**
- Consumes: `GET/POST /api/whatsapp/groups/[id]/leave`, `GET/POST /api/whatsapp/groups/[id]/participants`, `POST /api/whatsapp/groups/[id]/name` (Tarefas 3, 4, 5); `WhatsAppGroup.left_at` (Tarefa 2, já exposto por `GET /api/whatsapp/groups`).

Sem teste automatizado nesta tarefa — mesmo padrão das tarefas de UI das Fases 1-2 desta feature (não há testes de componente para telas de Configurações/Inbox no repo; cobertura é via a verificação manual da Tarefa 8).

- [ ] **Step 1: Chaves de tradução novas**

Em `messages/pt.json`, dentro de `"Settings": { "groups": { ... } }` (mesmo bloco de `readOnly`, `sync`, etc.), acrescentar:

```json
    "manage": "Gerenciar",
    "manageTitle": "Gerenciar grupo",
    "youLeft": "Você saiu",
    "leaveGroup": "Sair do grupo",
    "leaveConfirmTitle": "Sair deste grupo?",
    "leaveConfirmBody": "Isso desconecta o número deste grupo. Não é possível desfazer pelo CRM — alguém precisaria te readicionar pelo WhatsApp.",
    "leaveConfirmAction": "Sim, sair",
    "leaveSuccess": "Você saiu do grupo.",
    "leaveError": "Não foi possível sair do grupo.",
    "participantsTitle": "Participantes",
    "participantsLoadError": "Não foi possível carregar os participantes.",
    "adminBadge": "Admin",
    "addParticipant": "Adicionar participante",
    "addParticipantPlaceholder": "Telefone (com DDD e código do país)",
    "addParticipantAction": "Adicionar",
    "addParticipantSuccess": "Participante adicionado.",
    "addParticipantError": "Não foi possível adicionar o participante.",
    "removeParticipant": "Remover",
    "removeConfirmTitle": "Remover este participante?",
    "removeConfirmAction": "Sim, remover",
    "removeParticipantSuccess": "Participante removido.",
    "removeParticipantError": "Não foi possível remover o participante.",
    "promote": "Promover a admin",
    "demote": "Rebaixar",
    "promoteSuccess": "Participante promovido a admin.",
    "demoteSuccess": "Participante rebaixado.",
    "promoteError": "Não foi possível alterar o status de admin.",
    "renameLabel": "Nome do grupo",
    "renameSave": "Salvar",
    "renameSuccess": "Nome atualizado.",
    "renameError": "Não foi possível renomear o grupo.",
    "notAdminHint": "O número conectado não é admin deste grupo — apenas sair está disponível."
```

Em `messages/en.json`, mesmo bloco, tradução equivalente:

```json
    "manage": "Manage",
    "manageTitle": "Manage group",
    "youLeft": "You left",
    "leaveGroup": "Leave group",
    "leaveConfirmTitle": "Leave this group?",
    "leaveConfirmBody": "This disconnects the number from this group. It cannot be undone from the CRM — someone would need to re-add you on WhatsApp.",
    "leaveConfirmAction": "Yes, leave",
    "leaveSuccess": "You left the group.",
    "leaveError": "Could not leave the group.",
    "participantsTitle": "Participants",
    "participantsLoadError": "Could not load participants.",
    "adminBadge": "Admin",
    "addParticipant": "Add participant",
    "addParticipantPlaceholder": "Phone (with area and country code)",
    "addParticipantAction": "Add",
    "addParticipantSuccess": "Participant added.",
    "addParticipantError": "Could not add the participant.",
    "removeParticipant": "Remove",
    "removeConfirmTitle": "Remove this participant?",
    "removeConfirmAction": "Yes, remove",
    "removeParticipantSuccess": "Participant removed.",
    "removeParticipantError": "Could not remove the participant.",
    "promote": "Promote to admin",
    "demote": "Demote",
    "promoteSuccess": "Participant promoted to admin.",
    "demoteSuccess": "Participant demoted.",
    "promoteError": "Could not change admin status.",
    "renameLabel": "Group name",
    "renameSave": "Save",
    "renameSuccess": "Name updated.",
    "renameError": "Could not rename the group.",
    "notAdminHint": "The connected number is not an admin of this group — only leaving is available."
```

Em `messages/ko.json`, mesmo bloco:

```json
    "manage": "관리",
    "manageTitle": "그룹 관리",
    "youLeft": "나감",
    "leaveGroup": "그룹 나가기",
    "leaveConfirmTitle": "이 그룹을 나가시겠습니까?",
    "leaveConfirmBody": "이 작업은 연결된 번호를 그룹에서 제거합니다. CRM에서 되돌릴 수 없습니다 — 다시 추가하려면 WhatsApp에서 해야 합니다.",
    "leaveConfirmAction": "예, 나가기",
    "leaveSuccess": "그룹에서 나갔습니다.",
    "leaveError": "그룹을 나갈 수 없습니다.",
    "participantsTitle": "참가자",
    "participantsLoadError": "참가자를 불러올 수 없습니다.",
    "adminBadge": "관리자",
    "addParticipant": "참가자 추가",
    "addParticipantPlaceholder": "전화번호 (지역 및 국가 코드 포함)",
    "addParticipantAction": "추가",
    "addParticipantSuccess": "참가자가 추가되었습니다.",
    "addParticipantError": "참가자를 추가할 수 없습니다.",
    "removeParticipant": "제거",
    "removeConfirmTitle": "이 참가자를 제거하시겠습니까?",
    "removeConfirmAction": "예, 제거",
    "removeParticipantSuccess": "참가자가 제거되었습니다.",
    "removeParticipantError": "참가자를 제거할 수 없습니다.",
    "promote": "관리자로 승격",
    "demote": "강등",
    "promoteSuccess": "참가자가 관리자로 승격되었습니다.",
    "demoteSuccess": "참가자가 강등되었습니다.",
    "promoteError": "관리자 상태를 변경할 수 없습니다.",
    "renameLabel": "그룹 이름",
    "renameSave": "저장",
    "renameSuccess": "이름이 업데이트되었습니다.",
    "renameError": "그룹 이름을 변경할 수 없습니다.",
    "notAdminHint": "연결된 번호가 이 그룹의 관리자가 아닙니다 — 나가기만 가능합니다."
```

- [ ] **Step 2: Estender `WhatsAppGroup` e mostrar o badge "Você saiu"**

Em `groups-manager.tsx`, atualizar a interface (topo do arquivo):

```ts
interface WhatsAppGroup {
  id: string;
  group_jid: string;
  name: string | null;
  avatar_url: string | null;
  enabled: boolean;
  left_at: string | null;
}
```

No `<li>` de cada grupo (por volta da linha 186-227), envolver o `Switch` numa condicional — se `group.left_at`, mostrar um badge de texto no lugar do `Switch`:

```tsx
                  <div className="flex shrink-0 items-center gap-2">
                    {group.left_at ? (
                      <span className="text-muted-foreground text-xs italic">
                        {t('youLeft')}
                      </span>
                    ) : (
                      <>
                        <span className="text-muted-foreground hidden text-xs sm:inline">
                          {t('enabled')}
                        </span>
                        <Switch
                          checked={group.enabled}
                          disabled={!canEditSettings || togglingId === group.id}
                          onCheckedChange={(checked) =>
                            handleToggle(group, !!checked)
                          }
                          aria-label={t('enabled')}
                        />
                      </>
                    )}
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => openManage(group)}
                      aria-label={t('manage')}
                    >
                      <Settings className="size-4" />
                    </Button>
                  </div>
```

Acrescentar o import de `Settings` ao lado dos outros ícones de `lucide-react` (linha 31): `import { ImageOff, Loader2, RefreshCw, Settings, Users } from 'lucide-react';`.

- [ ] **Step 3: Estado e função para abrir o painel**

Logo depois dos `useState` existentes (linha ~57), acrescentar:

```ts
  const [manageGroup, setManageGroup] = useState<WhatsAppGroup | null>(null);

  function openManage(group: WhatsAppGroup) {
    setManageGroup(group);
  }
```

- [ ] **Step 4: Componente `GroupManageDialog` — participantes, renomear, sair**

Novo componente, no MESMO arquivo `groups-manager.tsx` (arquivo já pequeno — 235 linhas antes desta tarefa; manter junto evita um arquivo extra para uma peça que só este componente usa), logo antes de `export function GroupsManager()`:

```tsx
interface GroupParticipant {
  phoneNumber: string;
  isAdmin: boolean;
}

function GroupManageDialog({
  group,
  onClose,
  onLeft,
  onRenamed,
}: {
  group: WhatsAppGroup;
  onClose: () => void;
  onLeft: () => void;
  onRenamed: (name: string) => void;
}) {
  const t = useTranslations('Settings.groups');
  const [participants, setParticipants] = useState<GroupParticipant[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState(group.name ?? '');
  const [savingName, setSavingName] = useState(false);
  const [newPhone, setNewPhone] = useState('');
  const [addingPhone, setAddingPhone] = useState(false);
  const [busyPhone, setBusyPhone] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [leaving, setLeaving] = useState(false);

  const loadParticipants = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/whatsapp/groups/${group.id}/participants`, {
        cache: 'no-store',
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(payload.error || t('participantsLoadError'));
        return;
      }
      setParticipants((payload.participants ?? []) as GroupParticipant[]);
      setIsAdmin(!!payload.isConnectedNumberAdmin);
    } catch {
      toast.error(t('participantsLoadError'));
    } finally {
      setLoading(false);
    }
  }, [group.id, t]);

  useEffect(() => {
    void loadParticipants();
  }, [loadParticipants]);

  async function handleAction(action: 'add' | 'remove' | 'promote' | 'demote', phone: string) {
    setBusyPhone(phone);
    try {
      const res = await fetch(`/api/whatsapp/groups/${group.id}/participants`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, phone }),
      });
      const payload = await res.json().catch(() => ({}));
      const errorKey =
        action === 'add'
          ? 'addParticipantError'
          : action === 'remove'
            ? 'removeParticipantError'
            : 'promoteError';
      if (!res.ok) {
        toast.error(payload.error || t(errorKey));
        return;
      }
      setParticipants((payload.participants ?? []) as GroupParticipant[]);
      const successKey =
        action === 'add'
          ? 'addParticipantSuccess'
          : action === 'remove'
            ? 'removeParticipantSuccess'
            : action === 'promote'
              ? 'promoteSuccess'
              : 'demoteSuccess';
      toast.success(t(successKey));
    } catch {
      toast.error(t('networkError'));
    } finally {
      setBusyPhone(null);
      setConfirmRemove(null);
    }
  }

  async function handleAdd() {
    const phone = newPhone.trim();
    if (!phone) return;
    setAddingPhone(true);
    await handleAction('add', phone);
    setAddingPhone(false);
    setNewPhone('');
  }

  async function handleRename() {
    const trimmed = name.trim();
    if (!trimmed || trimmed === group.name) return;
    setSavingName(true);
    try {
      const res = await fetch(`/api/whatsapp/groups/${group.id}/name`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(payload.error || t('renameError'));
        return;
      }
      toast.success(t('renameSuccess'));
      onRenamed(trimmed);
    } catch {
      toast.error(t('networkError'));
    } finally {
      setSavingName(false);
    }
  }

  async function handleLeave() {
    setLeaving(true);
    try {
      const res = await fetch(`/api/whatsapp/groups/${group.id}/leave`, { method: 'POST' });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(payload.error || t('leaveError'));
        return;
      }
      toast.success(t('leaveSuccess'));
      onLeft();
    } catch {
      toast.error(t('networkError'));
    } finally {
      setLeaving(false);
      setConfirmLeave(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('manageTitle')}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <label className="text-muted-foreground text-xs">{t('renameLabel')}</label>
            <div className="mt-1 flex gap-2">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={!isAdmin || savingName}
              />
              {isAdmin && (
                <Button
                  size="sm"
                  onClick={handleRename}
                  disabled={savingName || !name.trim() || name.trim() === group.name}
                >
                  {savingName ? <Loader2 className="size-4 animate-spin" /> : t('renameSave')}
                </Button>
              )}
            </div>
          </div>

          {!isAdmin && !loading && (
            <p className="text-muted-foreground text-xs">{t('notAdminHint')}</p>
          )}

          <div>
            <p className="text-muted-foreground text-xs">{t('participantsTitle')}</p>
            {loading ? (
              <div className="flex justify-center py-4">
                <Loader2 className="size-4 animate-spin" />
              </div>
            ) : (
              <ul className="mt-2 divide-border divide-y">
                {participants.map((p) => (
                  <li key={p.phoneNumber} className="flex items-center justify-between gap-2 py-2 text-sm">
                    <span className="flex items-center gap-2">
                      {p.phoneNumber}
                      {p.isAdmin && (
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px]">
                          {t('adminBadge')}
                        </span>
                      )}
                    </span>
                    {isAdmin && (
                      <span className="flex shrink-0 gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busyPhone === p.phoneNumber}
                          onClick={() =>
                            handleAction(p.isAdmin ? 'demote' : 'promote', p.phoneNumber)
                          }
                        >
                          {p.isAdmin ? t('demote') : t('promote')}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive"
                          disabled={busyPhone === p.phoneNumber}
                          onClick={() => setConfirmRemove(p.phoneNumber)}
                        >
                          {t('removeParticipant')}
                        </Button>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {isAdmin && (
            <div>
              <label className="text-muted-foreground text-xs">{t('addParticipant')}</label>
              <div className="mt-1 flex gap-2">
                <Input
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  placeholder={t('addParticipantPlaceholder')}
                  disabled={addingPhone}
                />
                <Button size="sm" onClick={handleAdd} disabled={addingPhone || !newPhone.trim()}>
                  {addingPhone ? <Loader2 className="size-4 animate-spin" /> : t('addParticipantAction')}
                </Button>
              </div>
            </div>
          )}

          <Button
            variant="destructive"
            className="w-full"
            onClick={() => setConfirmLeave(true)}
          >
            {t('leaveGroup')}
          </Button>
        </div>
      </DialogContent>

      <AlertDialog open={!!confirmRemove} onOpenChange={(open) => !open && setConfirmRemove(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('removeConfirmTitle')}</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => confirmRemove && handleAction('remove', confirmRemove)}
            >
              {t('removeConfirmAction')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmLeave} onOpenChange={setConfirmLeave}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('leaveConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('leaveConfirmBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={leaving}>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleLeave} disabled={leaving}>
              {leaving ? <Loader2 className="size-4 animate-spin" /> : t('leaveConfirmAction')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
```

Acrescentar os imports novos no topo do arquivo:

```ts
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
```

(Conferir os nomes exatos exportados por `@/components/ui/alert-dialog`, `@/components/ui/dialog` e `@/components/ui/input` no repo antes de colar — este plano assume os mesmos nomes já usados em `message-composer.tsx`/`quick-reply-picker.tsx`; ajustar se o projeto usa outra convenção de export.)

A chave `t('cancel')` já existe em `Settings.groups`? Se não existir neste namespace, usar `Settings.groups.cancel` — acrescentar `"cancel": "Cancelar"` (pt) / `"Cancel"` (en) / `"취소"` (ko) junto das outras chaves do Step 1 se ainda não houver uma chave de cancelar genérica reaproveitável no mesmo arquivo.

- [ ] **Step 5: Renderizar o Dialog em `GroupsManager`**

No final do JSX de `GroupsManager` (logo antes do `</section>` de fechamento), acrescentar:

```tsx
      {manageGroup && (
        <GroupManageDialog
          group={manageGroup}
          onClose={() => setManageGroup(null)}
          onLeft={() => {
            setManageGroup(null);
            void load();
          }}
          onRenamed={(newName) => {
            setGroups((prev) =>
              prev.map((g) => (g.id === manageGroup.id ? { ...g, name: newName } : g)),
            );
            setManageGroup((prev) => (prev ? { ...prev, name: newName } : prev));
          }}
        />
      )}
```

- [ ] **Step 6: Typecheck + lint + suíte completa**

Run: `npx tsc --noEmit` — colar saída real, corrigir qualquer import/nome divergente do Step 4.
Run: `npx eslint src/components/settings/groups-manager.tsx` — 0 erros.
Run: `npx vitest run` — sem regressão (esta tarefa não deveria mudar nenhum resultado de teste, só adicionar UI).

- [ ] **Step 7: Commit**

```bash
git add src/components/settings/groups-manager.tsx messages/pt.json messages/en.json messages/ko.json
git commit -m "feat(grupos): painel de gestao em Configuracoes -- sair, participantes, renomear"
```

---

### Task 8: Verificação ponta a ponta em homologação

**Files:** nenhum (validação).

Esta tarefa é do coordenador do plano com o usuário real — um implementador automatizado não tem credenciais de login no CRM nem deve tomar decisões sobre o grupo real de teste sozinho. As Fases 1 e 2 provaram que essa verificação pega bugs que nenhum teste com fake pega.

- [ ] **Step 1: Publicar em homologação**

```bash
git push origin <branch>:staging
npx vercel ls
npx vercel alias set <deployment-novo> wacrm-git-staging-ramonppaula-5619s-projects.vercel.app
npx vercel inspect wacrm-git-staging-ramonppaula-5619s-projects.vercel.app
```

⚠️ O alias de homologação **não** atualiza sozinho — confirmar que a data do deployment é a de agora. Isso já causou confusão real nesta mesma feature (ver memória do projeto sobre o alias preso).

- [ ] **Step 2: Verificar os critérios de aceite com o usuário**

Usar o grupo real "Teste" (`120363429748080632@g.us`) — só o usuário e o número do CRM como membros, mesmo grupo já usado nas investigações anteriores. **Antes de qualquer clique que remova participante ou saia do grupo, confirmar com o usuário que ele está ciente e pronto** — mesmo sendo a UI (não uma chamada de API direta), a ação ainda é real e irreversível pelo CRM.

1. Abrir o painel de gestão de "Teste" — número conectado deve aparecer como admin (ou não, dependendo do estado atual do grupo — conferir antes) e as ações correspondentes aparecem/somem de acordo.
2. Adicionar um participante de teste por telefone → aparece na lista real do WhatsApp.
3. Remover esse mesmo participante de teste → some da lista real.
4. Promover/rebaixar um participante → status de admin muda no WhatsApp real.
5. Renomear o grupo → nome muda no WhatsApp real e no CRM, sem precisar sincronizar manualmente.
6. Sair do grupo → confirmar no WhatsApp do celular que o número saiu de verdade. Depois, no CRM: conversa vira somente-leitura, grupo some da lista habilitada com badge "Você saiu".
7. Tentar mandar mensagem nessa conversa (grupo já deixado) → recusado com erro claro.
8. Conferir no banco que nada foi criado/alterado em `contacts` durante todo o teste:
   ```sql
   SELECT COUNT(*) FROM contacts WHERE updated_at > '<momento do teste>';
   ```
   Esperado: `0`.
9. Logar como um usuário não-admin da conta e confirmar 403 ao tentar qualquer ação de escrita (ou, mais simples, confirmar que a UI já esconde os controles — mas testar a rota diretamente pelo menos uma vez para não confiar só na UI).
10. Reconectar o número ao grupo "Teste" ao final (mesmo processo manual usado após o incidente anterior), para deixar o ambiente de teste pronto para o futuro.

- [ ] **Step 3: Decidir sobre produção**

Só depois de todos os critérios passarem. A decisão de abrir PR e promover é do usuário — **não** promover por iniciativa própria. Lembrar: a migration desta fase (`20260905000001_group_left_at.sql`) precisa ser aplicada manualmente em produção antes do PR fazer efeito lá, do mesmo jeito que as duas migrations das Fases 1 e 2 foram (a integração Supabase→GitHub de produção aponta para `main`, abandonada).

---

## Notas de execução

- **A Tarefa 1 é a base de tudo.** Se `updateGroupParticipants` não checar `Error !== 0` corretamente, toda ação de participante vira um "sucesso" que não aconteceu — o mesmo tipo de erro que já causou o incidente real com `/group/leave` durante a investigação desta fase.
- **`left_at` é a trava central da Tarefa 6.** Sem ela, mandar mensagem para um grupo que o número já deixou tentaria mesmo assim e falharia de forma confusa lá na frente (erro genérico do provider, não um `bad_request` claro).
- **Nenhuma tarefa toca `shouldDispatchEngines`.** Se surgir a impressão de que é preciso, pare e reavalie — não é.
- **O alias de homologação exige `vercel alias set` a cada deploy**, e mais de uma sessão pode publicar em `staging` no mesmo dia — sempre conferir a data do deployment resolvido antes de pedir ao usuário para testar (ver memória do projeto sobre esse alias).

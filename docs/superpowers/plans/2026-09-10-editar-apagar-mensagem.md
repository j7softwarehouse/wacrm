# Editar e Apagar Mensagens Enviadas pelo CRM — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deixar o atendente editar ou apagar, pelo CRM, uma mensagem de
texto que ele mesmo enviou — replicando "Editar mensagem"/"Apagar para
todos" do WhatsApp, só em canais uazapi, sem nunca tocar `content_text`
ao apagar.

**Architecture:** Duas colunas novas em `messages` (soft-delete e
soft-edit, nunca apagam dado real); dois métodos novos no contrato
`WhatsAppProvider` (implementados de verdade só na uazapi, recusados na
Meta); duas rotas REST seguindo o esqueleto já usado por
`/api/whatsapp/react`; dois botões na barra de ações da bolha, um modo de
edição no composer. Propagação para outras abas/sessões é de graça —
`useRealtime` já escuta `UPDATE` em `messages` e mescla o payload no
estado local (`src/app/(dashboard)/inbox/page.tsx:319-324`).

**Tech Stack:** Next.js (App Router) / TypeScript / Supabase (Postgres +
Realtime) / uazapi (WhatsApp) / Vitest.

**Spec:** `docs/superpowers/specs/2026-09-10-editar-apagar-mensagem-design.md`

## Global Constraints

- Comentários e commits em português, seguindo a convenção já estabelecida.
- TDD real: RED→GREEN observado (rodar o teste falhando antes de implementar).
- **Apagar nunca toca `content_text`** — é o requisito central do usuário.
- `original_content_text` só é preenchido na **primeira** edição, nunca sobrescrito depois.
- Toda checagem de elegibilidade/permissão roda **antes** de chamar o provider.
- Nenhuma mudança em `meta.ts` além de lançar `ProviderUnsupportedError`.
- Só mensagem de texto (`content_type === 'text'`) pode ser editada; apagar vale para qualquer `content_type`.
- Só mensagem própria (`sender_type` `agent`/`bot`) pode ser editada/apagada — nunca `customer`.
- Recurso só existe em canal uazapi — Meta Cloud API não suporta.

---

### Task 1: Migration + tipo `Message`

**Files:**
- Create: `supabase/migrations/20260910000001_message_edit_delete.sql`
- Modify: `src/types/index.ts:258-298` (interface `Message`)

**Interfaces:**
- Produces: colunas `messages.deleted_at`, `messages.deleted_by`,
  `messages.edited_at`, `messages.original_content_text`, e os campos
  homônimos opcionais em `Message` — todas as tasks seguintes leem/gravam
  estes nomes exatos.

- [ ] **Step 1: Escrever a migration**

```sql
-- ============================================================
-- 20260910000001_message_edit_delete
--
-- Editar/apagar mensagem própria (spec 2026-09-10). Apagar NUNCA
-- limpa content_text — é a UI que troca a exibição por um
-- placeholder quando deleted_at existe. Editar sobrescreve
-- content_text com o texto atual; original_content_text guarda o
-- texto de antes da PRIMEIRA edição, nunca sobrescrito depois.
-- ============================================================
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS original_content_text TEXT;
```

- [ ] **Step 2: Rodar a migration em homolog**

Seguir o mesmo processo já usado nesta sessão para as migrations
anteriores de grupos (Supabase SQL Editor do projeto de homolog, ou
Management API com token pessoal) — **nunca** aplicar em produção nesta
task; produção só recebe migrations na promoção em bloco.

- [ ] **Step 3: Atualizar o tipo `Message`**

Em `src/types/index.ts`, dentro da interface `Message` (depois do campo
`ai_generated?: boolean;`, antes do `}` de fechamento em torno da linha
297):

```ts
  /** Preenchido quando o próprio atendente apaga a mensagem (Fase de
   *  editar/apagar, 2026-09-10). `content_text` NUNCA é limpo — a UI é
   *  que troca a exibição por um placeholder. */
  deleted_at?: string | null;
  deleted_by?: string | null;
  /** Preenchido na primeira edição. `content_text` passa a ser sempre
   *  o texto atual. */
  edited_at?: string | null;
  /** Texto de antes da PRIMEIRA edição — nunca sobrescrito depois,
   *  mesmo com edições seguintes. Uso interno/auditoria, nunca
   *  exibido na thread normal. */
  original_content_text?: string | null;
```

- [ ] **Step 4: Verificar que compila**

Run: `npx tsc --noEmit`
Expected: sem erros novos.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260910000001_message_edit_delete.sql src/types/index.ts
git commit -m "feat(mensagens): coluna de editar/apagar mensagem própria"
```

---

### Task 2: Contrato de provedor — `editMessage`/`deleteMessage`

**Files:**
- Modify: `src/lib/whatsapp/providers/types.ts` (interface `WhatsAppProvider`)
- Modify: `src/lib/whatsapp/providers/uazapi.ts`
- Modify: `src/lib/whatsapp/providers/meta.ts`
- Modify: `src/lib/whatsapp/providers/fake.ts`
- Test: `src/lib/whatsapp/providers/uazapi.test.ts`, `src/lib/whatsapp/providers/meta.test.ts`

**Interfaces:**
- Consumes: nada de tasks anteriores.
- Produces: `WhatsAppProvider.editMessage(args: { messageId: string; text: string }): Promise<void>` e
  `WhatsAppProvider.deleteMessage(args: { messageId: string }): Promise<void>` — Tasks 3 e 4 chamam
  exatamente estas assinaturas via `provider.editMessage(...)`/`provider.deleteMessage(...)`.

- [ ] **Step 1: Escrever os testes falhando (uazapi)**

Em `src/lib/whatsapp/providers/uazapi.test.ts`, adicionar ao final do
`describe("createUazapiProvider", ...)` já existente (usa o mesmo `post`
mockado no topo do arquivo):

```ts
  it("edita mensagem via /message/edit com id e text", async () => {
    const provider = createUazapiProvider(config);
    await provider.editMessage({ messageId: "MSG123", text: "texto novo" });
    expect(post).toHaveBeenCalledWith("/message/edit", {
      id: "MSG123",
      text: "texto novo",
    });
  });

  it("apaga mensagem via /message/delete com id", async () => {
    const provider = createUazapiProvider(config);
    await provider.deleteMessage({ messageId: "MSG123" });
    expect(post).toHaveBeenCalledWith("/message/delete", { id: "MSG123" });
  });
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/lib/whatsapp/providers/uazapi.test.ts`
Expected: FAIL — `provider.editMessage is not a function` (idem `deleteMessage`).

- [ ] **Step 3: Implementar em `uazapi.ts`**

Em `src/lib/whatsapp/providers/uazapi.ts`, adicionar `editMessage` e
`deleteMessage` ao import de tipos (linha 18-29) e ao objeto devolvido
por `createUazapiProvider`, logo depois de `sendReaction` (linha ~151):

```ts
    async editMessage(args: { messageId: string; text: string }): Promise<void> {
      await client.post("/message/edit", { id: args.messageId, text: args.text });
    },

    async deleteMessage(args: { messageId: string }): Promise<void> {
      await client.post("/message/delete", { id: args.messageId });
    },
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/lib/whatsapp/providers/uazapi.test.ts`
Expected: PASS.

- [ ] **Step 5: Escrever o teste falhando (meta)**

Em `src/lib/whatsapp/providers/meta.test.ts`, no
`describe("ProviderUnsupportedError na Meta", ...)`, adicionar ao teste
existente `"recusa leaveGroup, ..."` (ou um `it` novo ao lado):

```ts
  it("recusa editMessage e deleteMessage — Meta Cloud API não suporta", async () => {
    const provider = createMetaProvider(config);
    await expect(
      provider.editMessage({ messageId: "wamid.X", text: "novo" }),
    ).rejects.toBeInstanceOf(ProviderUnsupportedError);
    await expect(
      provider.deleteMessage({ messageId: "wamid.X" }),
    ).rejects.toBeInstanceOf(ProviderUnsupportedError);
  });
```

- [ ] **Step 6: Rodar e ver falhar**

Run: `npx vitest run src/lib/whatsapp/providers/meta.test.ts`
Expected: FAIL — `provider.editMessage is not a function`.

- [ ] **Step 7: Implementar em `meta.ts`**

No import de tipos (linha ~19-30), adicionar `editMessage`/`deleteMessage`
não precisam de tipo próprio importado (usam os mesmos `{messageId, text}`/
`{messageId}` inline). No objeto devolvido, ao lado de `leaveGroup`
(linha ~130):

```ts
    async editMessage(): Promise<void> {
      throw new ProviderUnsupportedError("meta", "editMessage");
    },
    async deleteMessage(): Promise<void> {
      throw new ProviderUnsupportedError("meta", "deleteMessage");
    },
```

- [ ] **Step 8: Atualizar o contrato `WhatsAppProvider`**

Em `src/lib/whatsapp/providers/types.ts`, ao final da interface
`WhatsAppProvider` (depois de `getGroupParticipants`, antes do `}` de
fechamento em torno da linha 183):

```ts
  /** Edita o texto de uma mensagem de texto já enviada por ESTA
   *  instância. Lança se o provedor não suportar (Meta) ou se o
   *  WhatsApp recusar (fora do prazo, mensagem não encontrada, etc). */
  editMessage(args: { messageId: string; text: string }): Promise<void>;
  /** Apaga uma mensagem enviada por ESTA instância, para todos os
   *  participantes. Lança se o provedor não suportar (Meta) ou se o
   *  WhatsApp recusar. */
  deleteMessage(args: { messageId: string }): Promise<void>;
```

- [ ] **Step 9: Implementar no `fake.ts`**

Em `src/lib/whatsapp/providers/fake.ts`, no objeto devolvido por
`createFakeProvider`, ao lado de `leaveGroup` (segue o mesmo estilo —
sem usar o helper `record`, que devolve `SendResult`; aqui o retorno é
`void`):

```ts
    async editMessage(args: { messageId: string; text: string }) {
      calls.push({ method: "editMessage", args });
    },
    async deleteMessage(args: { messageId: string }) {
      calls.push({ method: "deleteMessage", args });
    },
```

- [ ] **Step 10: Rodar todos os testes de provider e ver passar**

Run: `npx vitest run src/lib/whatsapp/providers/`
Expected: PASS (todos, incluindo os novos).

- [ ] **Step 11: Verificar que compila**

Run: `npx tsc --noEmit`
Expected: sem erros — `fake.ts`/`uazapi.ts`/`meta.ts` implementando o
contrato completo é o que garante isso (TypeScript recusa a build se
faltar um método da interface).

- [ ] **Step 12: Commit**

```bash
git add src/lib/whatsapp/providers/
git commit -m "feat(mensagens): editMessage/deleteMessage no contrato de provider"
```

---

### Task 3: `POST /api/whatsapp/messages/[id]/edit`

**Files:**
- Create: `src/app/api/whatsapp/messages/[id]/edit/route.ts`
- Test: `src/app/api/whatsapp/messages/[id]/edit/route.test.ts`

**Interfaces:**
- Consumes: `provider.editMessage({messageId, text}): Promise<void>` (Task 2);
  `getProviderForConversation(db, conversationId, accountId): Promise<WhatsAppProvider>` e
  `ChannelNotFoundError`/`NoChannelConfiguredError` de `@/lib/whatsapp/providers/resolve`;
  `canEditSettings(role): boolean`, `isAccountRole`, `AccountRole` de `@/lib/auth/roles`;
  `ProviderError` de `@/lib/whatsapp/providers/types` (mensagem de erro do provider).
- Produces: rota `POST /api/whatsapp/messages/[id]/edit`, body `{text: string}`,
  200 com `{message: {...linha atualizada...}}`, ou erro conforme Step 3.

- [ ] **Step 1: Escrever os testes falhando**

Criar `src/app/api/whatsapp/messages/[id]/edit/route.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getProviderForConversation: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));
vi.mock('@/lib/whatsapp/providers/resolve', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/whatsapp/providers/resolve')>();
  return { ...actual, getProviderForConversation: mocks.getProviderForConversation };
});

import { POST } from './route';
import { ProviderError } from '@/lib/whatsapp/providers/types';

// Simula profiles + messages + conversations respeitando de fato os
// `.eq(coluna, valor)` encadeados (AND), igual ao padrão já usado em
// groups/[id]/leave/route.test.ts — assim um teste com mensagem/conversa
// de OUTRA conta só "acha" a linha se a rota não filtrar por account_id,
// expondo falta de isolamento.
function comSessao(opts: {
  userId?: string;
  role: string;
  mensagem: Record<string, unknown> | null;
  conversa?: Record<string, unknown> | null;
  updateSpy?: (payload: unknown) => void;
}) {
  const { userId = 'user-1', role, mensagem, conversa, updateSpy } = opts;
  return {
    auth: { getUser: async () => ({ data: { user: { id: userId } }, error: null }) },
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
      if (table === 'messages') {
        const filtros: Record<string, unknown> = {};
        const chain = {
          select: () => chain,
          eq: (coluna: string, valor: unknown) => {
            filtros[coluna] = valor;
            return chain;
          },
          maybeSingle: async () => {
            if (!mensagem) return { data: null, error: null };
            const bate = Object.entries(filtros).every(
              ([coluna, valor]) => mensagem[coluna] === valor,
            );
            return { data: bate ? mensagem : null, error: null };
          },
          update: (payload: unknown) => {
            updateSpy?.(payload);
            return {
              eq: () => ({
                select: () => ({
                  single: async () => ({
                    data: { ...mensagem, ...(payload as object) },
                    error: null,
                  }),
                }),
              }),
            };
          },
        };
        return chain;
      }
      // conversations
      const filtrosConv: Record<string, unknown> = {};
      const chainConv = {
        select: () => chainConv,
        eq: (coluna: string, valor: unknown) => {
          filtrosConv[coluna] = valor;
          return chainConv;
        },
        maybeSingle: async () => {
          if (!conversa) return { data: null, error: null };
          const bate = Object.entries(filtrosConv).every(
            ([coluna, valor]) => conversa[coluna] === valor,
          );
          return { data: bate ? conversa : null, error: null };
        },
      };
      return chainConv;
    },
  };
}

function request(body: unknown) {
  return new Request('https://x/api/whatsapp/messages/m-1/edit', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}
const params = Promise.resolve({ id: 'm-1' });

const MSG_BASE = {
  id: 'm-1',
  conversation_id: 'conv-1',
  sender_type: 'agent',
  sender_id: 'user-1',
  content_type: 'text',
  content_text: 'texto antigo',
  message_id: 'WAMID-1',
  deleted_at: null,
  original_content_text: null,
};
const CONV_UAZAPI = { id: 'conv-1', account_id: 'acct-1', channel_id: 'chan-1' };

describe('POST /api/whatsapp/messages/[id]/edit', () => {
  beforeEach(() => vi.clearAllMocks());

  it('devolve 401 sem sessao', async () => {
    mocks.createClient.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    });
    const res = await POST(request({ text: 'novo' }), { params });
    expect(res.status).toBe(401);
  });

  it('devolve 404 quando a mensagem nao existe', async () => {
    mocks.createClient.mockResolvedValue(
      comSessao({ role: 'agent', mensagem: null }),
    );
    const res = await POST(request({ text: 'novo' }), { params });
    expect(res.status).toBe(404);
  });

  it('devolve 400 quando a mensagem e do cliente', async () => {
    mocks.createClient.mockResolvedValue(
      comSessao({
        role: 'agent',
        mensagem: { ...MSG_BASE, sender_type: 'customer' },
      }),
    );
    const res = await POST(request({ text: 'novo' }), { params });
    expect(res.status).toBe(400);
  });

  it('devolve 400 quando content_type nao e text', async () => {
    mocks.createClient.mockResolvedValue(
      comSessao({
        role: 'agent',
        mensagem: { ...MSG_BASE, content_type: 'image' },
      }),
    );
    const res = await POST(request({ text: 'novo' }), { params });
    expect(res.status).toBe(400);
  });

  it('devolve 400 quando a mensagem ja foi apagada', async () => {
    mocks.createClient.mockResolvedValue(
      comSessao({
        role: 'agent',
        mensagem: { ...MSG_BASE, deleted_at: '2026-09-10T00:00:00Z' },
      }),
    );
    const res = await POST(request({ text: 'novo' }), { params });
    expect(res.status).toBe(400);
  });

  it('devolve 400 quando a mensagem nao tem message_id (nao chegou a sair)', async () => {
    mocks.createClient.mockResolvedValue(
      comSessao({
        role: 'agent',
        mensagem: { ...MSG_BASE, message_id: null },
      }),
    );
    const res = await POST(request({ text: 'novo' }), { params });
    expect(res.status).toBe(400);
  });

  it('devolve 403 quando quem chama nao e o autor nem admin', async () => {
    mocks.createClient.mockResolvedValue(
      comSessao({ userId: 'user-2', role: 'agent', mensagem: MSG_BASE }),
    );
    const res = await POST(request({ text: 'novo' }), { params });
    expect(res.status).toBe(403);
  });

  it('admin pode editar mensagem de outro agente', async () => {
    mocks.createClient.mockResolvedValue(
      comSessao({
        userId: 'user-2',
        role: 'admin',
        mensagem: MSG_BASE,
        conversa: CONV_UAZAPI,
      }),
    );
    const editMessage = vi.fn(async () => {});
    mocks.getProviderForConversation.mockResolvedValue({ kind: 'uazapi', editMessage });

    const res = await POST(request({ text: 'novo texto' }), { params });
    expect(res.status).toBe(200);
    expect(editMessage).toHaveBeenCalledWith({ messageId: 'WAMID-1', text: 'novo texto' });
  });

  it('devolve 404 quando a conversa nao pertence a conta', async () => {
    mocks.createClient.mockResolvedValue(
      comSessao({
        role: 'agent',
        mensagem: MSG_BASE,
        conversa: { ...CONV_UAZAPI, account_id: 'acct-OUTRA' },
      }),
    );
    const res = await POST(request({ text: 'novo' }), { params });
    expect(res.status).toBe(404);
  });

  it('devolve 502 com a mensagem original quando o provider recusa', async () => {
    mocks.createClient.mockResolvedValue(
      comSessao({ role: 'agent', mensagem: MSG_BASE, conversa: CONV_UAZAPI }),
    );
    const editMessage = vi.fn(async () => {
      throw new ProviderError('uazapi', 'Fora do prazo permitido pelo WhatsApp.');
    });
    mocks.getProviderForConversation.mockResolvedValue({ kind: 'uazapi', editMessage });

    const res = await POST(request({ text: 'novo' }), { params });
    const body = await res.json();
    expect(res.status).toBe(502);
    expect(body.error).toBe('Fora do prazo permitido pelo WhatsApp.');
  });

  it('caminho feliz: chama o provider e grava content_text/edited_at/original_content_text', async () => {
    const updateSpy = vi.fn();
    mocks.createClient.mockResolvedValue(
      comSessao({
        role: 'agent',
        mensagem: MSG_BASE,
        conversa: CONV_UAZAPI,
        updateSpy,
      }),
    );
    const editMessage = vi.fn(async () => {});
    mocks.getProviderForConversation.mockResolvedValue({ kind: 'uazapi', editMessage });

    const res = await POST(request({ text: 'texto novo' }), { params });
    expect(res.status).toBe(200);
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        content_text: 'texto novo',
        original_content_text: 'texto antigo',
      }),
    );
    const payload = updateSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.edited_at).toEqual(expect.any(String));
  });

  it('segunda edicao NAO sobrescreve original_content_text ja preenchido', async () => {
    const updateSpy = vi.fn();
    mocks.createClient.mockResolvedValue(
      comSessao({
        role: 'agent',
        mensagem: { ...MSG_BASE, original_content_text: 'o texto de verdade original' },
        conversa: CONV_UAZAPI,
        updateSpy,
      }),
    );
    const editMessage = vi.fn(async () => {});
    mocks.getProviderForConversation.mockResolvedValue({ kind: 'uazapi', editMessage });

    await POST(request({ text: 'terceira versao' }), { params });
    const payload = updateSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.original_content_text).toBe('o texto de verdade original');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run "src/app/api/whatsapp/messages/[id]/edit/route.test.ts"`
Expected: FAIL — `Cannot find module './route'`.

- [ ] **Step 3: Implementar a rota**

Criar `src/app/api/whatsapp/messages/[id]/edit/route.ts`:

```ts
import { NextResponse } from 'next/server';

import { createClient } from '@/lib/supabase/server';
import { canEditSettings, isAccountRole, type AccountRole } from '@/lib/auth/roles';
import {
  getProviderForConversation,
  ChannelNotFoundError,
  NoChannelConfiguredError,
} from '@/lib/whatsapp/providers/resolve';
import { ProviderError } from '@/lib/whatsapp/providers/types';

// ============================================================
// POST /api/whatsapp/messages/[id]/edit — edita o texto de uma
// mensagem que o PRÓPRIO atendente enviou. Só canal uazapi (a Meta
// Cloud API não suporta editar mensagem enviada — ver
// providers/meta.ts). Body: { text: string }.
// ============================================================

type MessagesSupabase = Awaited<ReturnType<typeof createClient>>;

interface CallerProfile {
  accountId: string;
  role: AccountRole | null;
}

async function resolveCallerProfile(
  supabase: MessagesSupabase,
  userId: string,
): Promise<CallerProfile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('account_id, account_role')
    .eq('user_id', userId)
    .maybeSingle();

  if (error || !data?.account_id) return null;

  return {
    accountId: data.account_id as string,
    role: isAccountRole(data.account_role) ? data.account_role : null,
  };
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
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const text = typeof body?.text === 'string' ? body.text.trim() : '';
    if (!text) {
      return NextResponse.json({ error: 'text is required' }, { status: 400 });
    }

    const profile = await resolveCallerProfile(supabase, user.id);
    if (!profile) {
      return NextResponse.json(
        { error: 'Your profile is not linked to an account.' },
        { status: 403 },
      );
    }

    const { data: message, error: msgError } = await supabase
      .from('messages')
      .select(
        'id, conversation_id, sender_type, sender_id, content_type, content_text, message_id, deleted_at, original_content_text',
      )
      .eq('id', id)
      .maybeSingle();

    if (msgError || !message) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 });
    }

    // Elegibilidade — antes de qualquer checagem de permissão ou
    // chamada ao provider (Global Constraint da spec).
    if (message.sender_type !== 'agent' && message.sender_type !== 'bot') {
      return NextResponse.json(
        { error: 'Only messages sent by the CRM can be edited.' },
        { status: 400 },
      );
    }
    if (message.content_type !== 'text') {
      return NextResponse.json(
        { error: 'Only plain text messages can be edited.' },
        { status: 400 },
      );
    }
    if (message.deleted_at) {
      return NextResponse.json(
        { error: 'This message was deleted and cannot be edited.' },
        { status: 400 },
      );
    }
    if (!message.message_id) {
      return NextResponse.json(
        { error: 'This message was never delivered to WhatsApp.' },
        { status: 400 },
      );
    }

    // Permissão: autor original, ou admin/owner da conta.
    const isAuthor = message.sender_id === user.id;
    if (!isAuthor && !canEditSettings(profile.role ?? 'viewer')) {
      return NextResponse.json(
        { error: 'You can only edit your own messages.' },
        { status: 403 },
      );
    }

    const { data: conversation, error: convError } = await supabase
      .from('conversations')
      .select('id, account_id')
      .eq('id', message.conversation_id)
      .eq('account_id', profile.accountId)
      .maybeSingle();

    if (convError || !conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }

    let provider;
    try {
      provider = await getProviderForConversation(
        supabase,
        conversation.id,
        profile.accountId,
      );
    } catch (err) {
      if (err instanceof NoChannelConfiguredError || err instanceof ChannelNotFoundError) {
        return NextResponse.json({ error: 'WhatsApp not configured.' }, { status: 400 });
      }
      throw err;
    }

    if (provider.kind !== 'uazapi') {
      return NextResponse.json(
        { error: 'Editing messages is only available on uazapi channels.' },
        { status: 400 },
      );
    }

    try {
      await provider.editMessage({ messageId: message.message_id, text });
    } catch (err) {
      const reason = err instanceof ProviderError ? err.message : 'Unknown provider error';
      return NextResponse.json({ error: reason }, { status: 502 });
    }

    const { data: updated, error: updateError } = await supabase
      .from('messages')
      .update({
        content_text: text,
        edited_at: new Date().toISOString(),
        original_content_text: message.original_content_text ?? message.content_text,
      })
      .eq('id', id)
      .select()
      .single();

    if (updateError) {
      return NextResponse.json(
        { error: 'Message edited on WhatsApp but failed to update in the database.' },
        { status: 500 },
      );
    }

    return NextResponse.json({ message: updated });
  } catch (error) {
    console.error('Error in POST .../messages/[id]/edit:', error);
    return NextResponse.json({ error: 'Failed to edit message' }, { status: 500 });
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run "src/app/api/whatsapp/messages/[id]/edit/route.test.ts"`
Expected: PASS (todos os cenários).

- [ ] **Step 5: Verificar que compila**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 6: Commit**

```bash
git add "src/app/api/whatsapp/messages/[id]/edit/"
git commit -m "feat(mensagens): rota de editar mensagem propria (POST .../edit)"
```

---

### Task 4: `POST /api/whatsapp/messages/[id]/delete`

**Files:**
- Create: `src/app/api/whatsapp/messages/[id]/delete/route.ts`
- Test: `src/app/api/whatsapp/messages/[id]/delete/route.test.ts`

**Interfaces:**
- Consumes: `provider.deleteMessage({messageId}): Promise<void>` (Task 2); mesmos
  helpers de `getProviderForConversation`/`canEditSettings`/`ProviderError` da Task 3.
- Produces: rota `POST /api/whatsapp/messages/[id]/delete`, sem body, 200
  com `{success: true}`, `content_text` **nunca** tocado.

- [ ] **Step 1: Escrever os testes falhando**

Criar `src/app/api/whatsapp/messages/[id]/delete/route.test.ts` — mesmo
helper `comSessao` da Task 3 (copiado, sem `content_type`/`message_id`
irrelevantes para apagar removidos da checagem):

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getProviderForConversation: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));
vi.mock('@/lib/whatsapp/providers/resolve', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/whatsapp/providers/resolve')>();
  return { ...actual, getProviderForConversation: mocks.getProviderForConversation };
});

import { POST } from './route';
import { ProviderError } from '@/lib/whatsapp/providers/types';

function comSessao(opts: {
  userId?: string;
  role: string;
  mensagem: Record<string, unknown> | null;
  conversa?: Record<string, unknown> | null;
  updateSpy?: (payload: unknown) => void;
}) {
  const { userId = 'user-1', role, mensagem, conversa, updateSpy } = opts;
  return {
    auth: { getUser: async () => ({ data: { user: { id: userId } }, error: null }) },
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
      if (table === 'messages') {
        const filtros: Record<string, unknown> = {};
        const chain = {
          select: () => chain,
          eq: (coluna: string, valor: unknown) => {
            filtros[coluna] = valor;
            return chain;
          },
          maybeSingle: async () => {
            if (!mensagem) return { data: null, error: null };
            const bate = Object.entries(filtros).every(
              ([coluna, valor]) => mensagem[coluna] === valor,
            );
            return { data: bate ? mensagem : null, error: null };
          },
          update: (payload: unknown) => {
            updateSpy?.(payload);
            return { eq: async () => ({ error: null }) };
          },
        };
        return chain;
      }
      const filtrosConv: Record<string, unknown> = {};
      const chainConv = {
        select: () => chainConv,
        eq: (coluna: string, valor: unknown) => {
          filtrosConv[coluna] = valor;
          return chainConv;
        },
        maybeSingle: async () => {
          if (!conversa) return { data: null, error: null };
          const bate = Object.entries(filtrosConv).every(
            ([coluna, valor]) => conversa[coluna] === valor,
          );
          return { data: bate ? conversa : null, error: null };
        },
      };
      return chainConv;
    },
  };
}

function request() {
  return new Request('https://x/api/whatsapp/messages/m-1/delete', { method: 'POST' });
}
const params = Promise.resolve({ id: 'm-1' });

const MSG_BASE = {
  id: 'm-1',
  conversation_id: 'conv-1',
  sender_type: 'agent',
  sender_id: 'user-1',
  content_type: 'image',
  content_text: 'legenda original',
  message_id: 'WAMID-1',
  deleted_at: null,
};
const CONV_UAZAPI = { id: 'conv-1', account_id: 'acct-1', channel_id: 'chan-1' };

describe('POST /api/whatsapp/messages/[id]/delete', () => {
  beforeEach(() => vi.clearAllMocks());

  it('devolve 401 sem sessao', async () => {
    mocks.createClient.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    });
    const res = await POST(request(), { params });
    expect(res.status).toBe(401);
  });

  it('devolve 404 quando a mensagem nao existe', async () => {
    mocks.createClient.mockResolvedValue(
      comSessao({ role: 'agent', mensagem: null }),
    );
    const res = await POST(request(), { params });
    expect(res.status).toBe(404);
  });

  it('devolve 400 quando a mensagem e do cliente', async () => {
    mocks.createClient.mockResolvedValue(
      comSessao({ role: 'agent', mensagem: { ...MSG_BASE, sender_type: 'customer' } }),
    );
    const res = await POST(request(), { params });
    expect(res.status).toBe(400);
  });

  it('devolve 400 quando ja foi apagada', async () => {
    mocks.createClient.mockResolvedValue(
      comSessao({
        role: 'agent',
        mensagem: { ...MSG_BASE, deleted_at: '2026-09-10T00:00:00Z' },
      }),
    );
    const res = await POST(request(), { params });
    expect(res.status).toBe(400);
  });

  it('devolve 403 quando quem chama nao e o autor nem admin', async () => {
    mocks.createClient.mockResolvedValue(
      comSessao({ userId: 'user-2', role: 'agent', mensagem: MSG_BASE }),
    );
    const res = await POST(request(), { params });
    expect(res.status).toBe(403);
  });

  it('devolve 502 com a mensagem original quando o provider recusa', async () => {
    mocks.createClient.mockResolvedValue(
      comSessao({ role: 'agent', mensagem: MSG_BASE, conversa: CONV_UAZAPI }),
    );
    const deleteMessage = vi.fn(async () => {
      throw new ProviderError('uazapi', 'Mensagem não encontrada na uazapi.');
    });
    mocks.getProviderForConversation.mockResolvedValue({ kind: 'uazapi', deleteMessage });

    const res = await POST(request(), { params });
    const body = await res.json();
    expect(res.status).toBe(502);
    expect(body.error).toBe('Mensagem não encontrada na uazapi.');
  });

  it('caminho feliz: chama o provider e grava deleted_at/deleted_by sem tocar content_text', async () => {
    const updateSpy = vi.fn();
    mocks.createClient.mockResolvedValue(
      comSessao({
        role: 'agent',
        mensagem: MSG_BASE,
        conversa: CONV_UAZAPI,
        updateSpy,
      }),
    );
    const deleteMessage = vi.fn(async () => {});
    mocks.getProviderForConversation.mockResolvedValue({ kind: 'uazapi', deleteMessage });

    const res = await POST(request(), { params });
    expect(res.status).toBe(200);
    expect(deleteMessage).toHaveBeenCalledWith({ messageId: 'WAMID-1' });

    const payload = updateSpy.mock.calls[0][0] as Record<string, unknown>;
    // Garantia real, não só o sintoma: content_text jamais aparece no
    // payload de update — a coluna nunca é tocada.
    expect(payload).not.toHaveProperty('content_text');
    expect(payload.deleted_by).toBe('user-1');
    expect(payload.deleted_at).toEqual(expect.any(String));
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run "src/app/api/whatsapp/messages/[id]/delete/route.test.ts"`
Expected: FAIL — `Cannot find module './route'`.

- [ ] **Step 3: Implementar a rota**

Criar `src/app/api/whatsapp/messages/[id]/delete/route.ts`:

```ts
import { NextResponse } from 'next/server';

import { createClient } from '@/lib/supabase/server';
import { canEditSettings, isAccountRole, type AccountRole } from '@/lib/auth/roles';
import {
  getProviderForConversation,
  ChannelNotFoundError,
  NoChannelConfiguredError,
} from '@/lib/whatsapp/providers/resolve';
import { ProviderError } from '@/lib/whatsapp/providers/types';

// ============================================================
// POST /api/whatsapp/messages/[id]/delete — apaga (para todos, no
// WhatsApp) uma mensagem que o PRÓPRIO atendente enviou. NUNCA toca
// `content_text` — só marca deleted_at/deleted_by; a UI decide
// exibir um placeholder. Só canal uazapi.
// ============================================================

type MessagesSupabase = Awaited<ReturnType<typeof createClient>>;

interface CallerProfile {
  accountId: string;
  role: AccountRole | null;
}

async function resolveCallerProfile(
  supabase: MessagesSupabase,
  userId: string,
): Promise<CallerProfile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('account_id, account_role')
    .eq('user_id', userId)
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
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const profile = await resolveCallerProfile(supabase, user.id);
    if (!profile) {
      return NextResponse.json(
        { error: 'Your profile is not linked to an account.' },
        { status: 403 },
      );
    }

    const { data: message, error: msgError } = await supabase
      .from('messages')
      .select('id, conversation_id, sender_type, sender_id, message_id, deleted_at')
      .eq('id', id)
      .maybeSingle();

    if (msgError || !message) {
      return NextResponse.json({ error: 'Message not found' }, { status: 404 });
    }

    if (message.sender_type !== 'agent' && message.sender_type !== 'bot') {
      return NextResponse.json(
        { error: 'Only messages sent by the CRM can be deleted.' },
        { status: 400 },
      );
    }
    if (message.deleted_at) {
      return NextResponse.json(
        { error: 'This message was already deleted.' },
        { status: 400 },
      );
    }
    if (!message.message_id) {
      return NextResponse.json(
        { error: 'This message was never delivered to WhatsApp.' },
        { status: 400 },
      );
    }

    const isAuthor = message.sender_id === user.id;
    if (!isAuthor && !canEditSettings(profile.role ?? 'viewer')) {
      return NextResponse.json(
        { error: 'You can only delete your own messages.' },
        { status: 403 },
      );
    }

    const { data: conversation, error: convError } = await supabase
      .from('conversations')
      .select('id, account_id')
      .eq('id', message.conversation_id)
      .eq('account_id', profile.accountId)
      .maybeSingle();

    if (convError || !conversation) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }

    let provider;
    try {
      provider = await getProviderForConversation(
        supabase,
        conversation.id,
        profile.accountId,
      );
    } catch (err) {
      if (err instanceof NoChannelConfiguredError || err instanceof ChannelNotFoundError) {
        return NextResponse.json({ error: 'WhatsApp not configured.' }, { status: 400 });
      }
      throw err;
    }

    if (provider.kind !== 'uazapi') {
      return NextResponse.json(
        { error: 'Deleting messages is only available on uazapi channels.' },
        { status: 400 },
      );
    }

    try {
      await provider.deleteMessage({ messageId: message.message_id });
    } catch (err) {
      const reason = err instanceof ProviderError ? err.message : 'Unknown provider error';
      return NextResponse.json({ error: reason }, { status: 502 });
    }

    // `content_text` NUNCA aparece aqui — é o requisito central do
    // usuário (manter no banco, esconder só no front).
    const { error: updateError } = await supabase
      .from('messages')
      .update({
        deleted_at: new Date().toISOString(),
        deleted_by: user.id,
      })
      .eq('id', id);

    if (updateError) {
      return NextResponse.json(
        { error: 'Message deleted on WhatsApp but failed to update in the database.' },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error in POST .../messages/[id]/delete:', error);
    return NextResponse.json({ error: 'Failed to delete message' }, { status: 500 });
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run "src/app/api/whatsapp/messages/[id]/delete/route.test.ts"`
Expected: PASS.

- [ ] **Step 5: Verificar que compila**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 6: Commit**

```bash
git add "src/app/api/whatsapp/messages/[id]/delete/"
git commit -m "feat(mensagens): rota de apagar mensagem propria (POST .../delete)"
```

---

### Task 5: UI — apagar mensagem (botão, confirmação, placeholder)

**Files:**
- Modify: `src/components/inbox/message-actions.tsx`
- Modify: `src/components/inbox/message-bubble.tsx`
- Modify: `src/components/inbox/reply-quote.tsx`
- Modify: `src/components/inbox/message-thread.tsx`
- Modify: `messages/pt.json`, `messages/en.json`, `messages/ko.json`
- Test: `src/components/inbox/reply-quote.test.ts` (criar — `buildReplyPreview` hoje não tem teste próprio; ver Step 1)

**Interfaces:**
- Consumes: `Message.deleted_at` (Task 1); nada de rota (a chamada HTTP mora em `message-thread.tsx`, direto).
- Produces: `MessageActions` ganha prop opcional `onDelete?: () => void` — Task 6 não
  depende disto, mas convive no mesmo componente.

- [ ] **Step 1: Escrever o teste falhando para `buildReplyPreview`**

Criar `src/components/inbox/reply-quote.test.ts` (arquivo novo — a
função existe mas nunca teve teste unitário próprio; cobrir o
comportamento novo já cobre de graça o antigo):

```ts
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
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/components/inbox/reply-quote.test.ts`
Expected: FAIL — recebe `"texto que ainda está no banco"`, esperava `"[deletedMessage]"`.

- [ ] **Step 3: Ajustar `buildReplyPreview`**

Em `src/components/inbox/reply-quote.tsx`, no início da função (linha ~79-80):

```ts
export function buildReplyPreview(message: Message, t: ReturnType<typeof useTranslations>): string {
  if (message.deleted_at) return t("deletedMessage");
  if (message.content_text) return message.content_text;
  switch (message.content_type) {
```

(resto da função inalterado)

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/components/inbox/reply-quote.test.ts`
Expected: PASS.

- [ ] **Step 5: Adicionar as chaves de tradução**

Em `messages/pt.json`, dentro de `Inbox.replyQuote`, adicionar (ao lado
de `"message": "[Mensagem]"`):

```json
    "deletedMessage": "[Mensagem apagada]"
```

Em `messages/pt.json`, dentro de `Inbox.bubble`, adicionar (ao lado de
`"unsupported"`):

```json
    "deletedMessage": "Mensagem apagada",
    "editedTag": "(editado)"
```

Em `messages/pt.json`, dentro de `Inbox.actions`, adicionar (o `"delete"`
já existe — "Deletar" — reaproveitar; adicionar só a confirmação):

```json
    "deleteConfirmBody": "Apagar esta mensagem para todos no WhatsApp? Esta ação não pode ser desfeita.",
    "deleteSuccess": "Mensagem apagada",
    "deleteError": "Não foi possível apagar a mensagem"
```

Repetir a mesma estrutura de chaves em `messages/en.json` (em inglês) e
`messages/ko.json` (em coreano) — mesmas chaves, mesma posição dentro de
`Inbox.replyQuote`/`Inbox.bubble`/`Inbox.actions`, valor traduzido.

- [ ] **Step 6: Bolha mostra o placeholder quando apagada**

Em `src/components/inbox/message-bubble.tsx`, dentro de `MessageContent`
(a função que já faz o `switch (message.content_type)`, linha 173),
adicionar a checagem ANTES do switch — apagada tem prioridade sobre
qualquer `content_type`:

```ts
function MessageContent({ message, t }: { message: Message, t: ReturnType<typeof useTranslations> }) {
  if (message.deleted_at) {
    return (
      <p className="text-sm italic text-muted-foreground">
        {t("deletedMessage")}
      </p>
    );
  }

  switch (message.content_type) {
```

E, no mesmo arquivo, dentro de `MessageBubble` (a função exportada),
onde hoje `MessageContent` é chamado (linha ~374), nada muda — a checagem
já vive dentro de `MessageContent`. Isso também esconde reações/mídia
automaticamente, porque `MessageContent` é a única coisa renderizada no
corpo da bolha.

- [ ] **Step 7: Adicionar o botão de apagar em `MessageActions`**

Em `src/components/inbox/message-actions.tsx`:

Adicionar `Trash2` ao import de ícones (linha 4):

```ts
import { CornerUpLeft, Copy, SmilePlus, Trash2 } from "lucide-react";
```

Adicionar a prop na interface (depois de `onReact`, linha ~22):

```ts
interface MessageActionsProps {
  message: Message;
  onReply: () => void;
  onReact: (emoji: string) => void;
  /** Ausente = botão de apagar não aparece (mensagem do cliente,
   *  canal não-uazapi, ou sem permissão — decidido pelo chamador). */
  onDelete?: () => void;
  children: ReactNode;
}
```

Desestruturar no componente (linha ~31-36):

```ts
export function MessageActions({
  message,
  onReply,
  onReact,
  onDelete,
  children,
}: MessageActionsProps) {
```

Adicionar o handler (ao lado de `handleReply`, linha ~74-77):

```ts
  const handleDelete = () => {
    onDelete?.();
    setTouchOpen(false);
  };
```

Adicionar o botão na barra (depois do botão de copiar, antes do `</div>`
de fechamento da barra, linha ~146):

```ts
        {onDelete && (
          <button
            type="button"
            onClick={handleDelete}
            className="flex h-5 w-5 items-center justify-center rounded-full text-popover-foreground hover:bg-muted hover:text-destructive"
            aria-label={t("delete")}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
```

`message` já é uma prop recebida (usada para `isAgent` logo no topo do
componente) — nenhuma mudança de assinatura além da nova prop `onDelete`.

- [ ] **Step 8: Confirmação + wiring em `message-thread.tsx`**

O projeto não usa um componente de diálogo para confirmações
destrutivas — todo `handleRemove`/"apagar" existente (ex.:
`src/components/settings/channels-manager.tsx:118-122`) usa
`window.confirm(...)` simples. Seguir o mesmo padrão aqui, sem introduzir
um componente novo.

Handler que confirma e chama a rota (mesmo estilo de `handleSend`, sem
atualização otimista local — a Realtime UPDATE em `messages` já propaga
o `deleted_at` pra bolha, ver
`src/app/(dashboard)/inbox/page.tsx:319-324`):

```ts
  const handleDeleteMessage = useCallback(async (messageId: string) => {
    if (!window.confirm(t("actions.deleteConfirmBody"))) return;

    try {
      const res = await fetch(`/api/whatsapp/messages/${messageId}/delete`, {
        method: "POST",
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(payload?.error || t("actions.deleteError"));
        return;
      }
      toast.success(t("actions.deleteSuccess"));
    } catch (err) {
      console.error("Failed to delete message:", err);
      toast.error(t("actions.deleteError"));
    }
  }, [t]);
```

No loop de renderização das mensagens (linha ~1268-1319), calcular se o
botão de apagar deve aparecer e passar `onDelete`:

```ts
                    const isOwnAndNotDeleted =
                      (msg.sender_type === "agent" || msg.sender_type === "bot") &&
                      !msg.deleted_at;
                    const canDeleteMsg =
                      isOwnAndNotDeleted &&
                      threadChannel?.provider === "uazapi" &&
                      (msg.sender_id === user?.id || canEditSettings);
                    return (
                      <MessageActions
                        key={msg.id}
                        message={msg}
                        onReply={() => handleStartReply(msg)}
                        onReact={(emoji) => {
                          if (emoji) void postReaction(msg.id, emoji);
                        }}
                        onDelete={canDeleteMsg ? () => void handleDeleteMessage(msg.id) : undefined}
                      >
```

(`canEditSettings` já vem de `useAuth()` — checar se `message-thread.tsx`
já desestrutura isso na linha do `const { user } = useAuth();`; se não,
trocar por `const { user, canEditSettings } = useAuth();`.)

Como a confirmação já acontece dentro de `handleDeleteMessage` via
`window.confirm`, as chaves `deleteConfirmTitle`/`deleteConfirmAction`/
`deleteConfirmCancel` do Step 5 não são usadas por um componente de
diálogo — remover essas três do Step 5 e manter só
`deleteConfirmBody`/`deleteSuccess`/`deleteError` (o texto do
`window.confirm` usa `deleteConfirmBody` diretamente).

- [ ] **Step 9: Rodar a suíte de inbox e ver tudo passar**

Run: `npx vitest run src/components/inbox/ src/app/\(dashboard\)/inbox/`
Expected: PASS — nenhum teste existente quebrado.

- [ ] **Step 10: Verificar que compila**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 11: Commit**

```bash
git add src/components/inbox/ messages/pt.json messages/en.json messages/ko.json
git commit -m "feat(mensagens): UI de apagar mensagem propria (placeholder + confirmacao)"
```

---

### Task 6: UI — editar mensagem (botão, modo de edição no composer, badge)

**Files:**
- Modify: `src/components/inbox/message-actions.tsx`
- Modify: `src/components/inbox/message-bubble.tsx`
- Modify: `src/components/inbox/message-composer.tsx`
- Modify: `src/components/inbox/message-thread.tsx`
- Modify: `messages/pt.json`, `messages/en.json`, `messages/ko.json`

**Interfaces:**
- Consumes: `Message.edited_at` (Task 1); `MessageActions` (Task 5, já com `onDelete`).
- Produces: `MessageComposer` ganha `editingMessage?: {id: string; text: string} | null` e
  `onSubmitEdit?: (id: string, text: string) => void` e `onCancelEdit?: () => void`.

- [ ] **Step 1: Badge "(editado)" na bolha**

Em `src/components/inbox/message-bubble.tsx`, na linha do timestamp
(dentro do `<div className="mt-1 flex items-center gap-1" ...>`, logo
antes do `<span>{time}</span>`, linha ~394):

```tsx
          {message.edited_at && !message.deleted_at && (
            <span
              className={cn(
                "text-[10px] italic",
                isAgent ? "text-primary-foreground/70" : "text-muted-foreground",
              )}
            >
              {t("editedTag")}
            </span>
          )}
```

(`editedTag` já foi adicionado a `Inbox.bubble` na Task 5, Step 5 — se
esta task rodar isolada, adicionar agora do mesmo jeito.)

- [ ] **Step 2: Botão de editar em `MessageActions`**

Em `src/components/inbox/message-actions.tsx`, adicionar `Pencil` ao
import de ícones (mesma linha do `Trash2` da Task 5):

```ts
import { CornerUpLeft, Copy, Pencil, SmilePlus, Trash2 } from "lucide-react";
```

Adicionar a prop (ao lado de `onDelete`):

```ts
  /** Ausente = botão de editar não aparece (mensagem não é de texto,
   *  já apagada, canal não-uazapi, ou sem permissão). */
  onEdit?: () => void;
```

Desestruturar e adicionar handler (mesmo padrão de `handleDelete`):

```ts
  const handleEdit = () => {
    onEdit?.();
    setTouchOpen(false);
  };
```

Adicionar o botão na barra, antes do de apagar:

```ts
        {onEdit && (
          <button
            type="button"
            onClick={handleEdit}
            className="flex h-5 w-5 items-center justify-center rounded-full text-popover-foreground hover:bg-muted hover:text-foreground"
            aria-label={t("edit")}
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        )}
```

Adicionar a chave `"edit": "Editar"` em `Inbox.actions` nos três
arquivos de tradução (pt/en/ko).

- [ ] **Step 3: Modo de edição no composer**

Em `src/components/inbox/message-composer.tsx`:

Adicionar as props na interface (ao lado de `replyTo`/`onClearReply`,
linha ~154):

```ts
  /** Presente → composer entra em modo edição: texto pré-preenchido,
   *  enviar chama `onSubmitEdit` em vez de `onSend`. */
  editingMessage?: { id: string; text: string } | null;
  onSubmitEdit?: (id: string, text: string) => void;
  onCancelEdit?: () => void;
```

Desestruturar (linha ~182):

```ts
  editingMessage,
  onSubmitEdit,
  onCancelEdit,
```

Pré-preencher o texto quando `editingMessage` aparece — novo `useEffect`
perto dos outros (depois do `useState` de `text`, linha ~185):

```ts
  useEffect(() => {
    if (editingMessage) {
      setText(editingMessage.text);
      textareaRef.current?.focus();
    }
  }, [editingMessage]);
```

Alterar `handleSend` para desviar para edição (linha ~262-283) — a
condição de guarda e o corpo do `try` mudam, o resto (spinner de
`sending`, reset da altura do textarea) fica igual:

```ts
  const handleSend = useCallback(async () => {
    const trimmed = text.trim();
    if (!trimmed || sending || sessionExpired || sendBlocked) return;

    setSending(true);
    try {
      if (editingMessage) {
        onSubmitEdit?.(editingMessage.id, trimmed);
        onCancelEdit?.();
      } else {
        onSend(trimmed, replyTo?.id);
      }
      setText("");
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }
    } finally {
      setSending(false);
    }
  }, [
    text,
    sending,
    sessionExpired,
    sendBlocked,
    onSend,
    replyTo?.id,
    editingMessage,
    onSubmitEdit,
    onCancelEdit,
  ]);
```

Renderizar uma faixa "Editando mensagem" no lugar da citação de resposta
quando em modo edição — próximo de onde `replyTo` já renderiza seu chip
(linha ~586), como um bloco `if/else` (só um dos dois aparece por vez;
não faz sentido editar E responder ao mesmo tempo):

```tsx
      {editingMessage ? (
        <div className="mb-2 flex items-center justify-between rounded-md bg-muted px-2 py-1.5 text-xs">
          <span className="text-muted-foreground">{t("editingMessage")}</span>
          <button
            type="button"
            onClick={() => {
              onCancelEdit?.();
              setText("");
            }}
            aria-label={t("cancelEdit")}
            className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-background hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        replyTo && (
          <ReplyQuote
            authorLabel={replyTo.authorLabel}
            preview={replyTo.preview}
            onDismiss={onClearReply}
          />
        )
      )}
```

(`X` de `lucide-react` — checar se já está importado no topo do arquivo;
se não, adicionar ao import existente de ícones.)

Adicionar `"editingMessage": "Editando mensagem"` e `"cancelEdit":
"Cancelar edição"` em `Inbox.composer` nos três arquivos de tradução.

- [ ] **Step 4: Wiring em `message-thread.tsx`**

Estado + handlers (ao lado de `replyTo`/`handleStartReply`):

```ts
  const [editingMessage, setEditingMessage] = useState<{ id: string; text: string } | null>(null);

  const handleStartEdit = useCallback((msg: Message) => {
    setEditingMessage({ id: msg.id, text: msg.content_text ?? "" });
  }, []);

  const handleSubmitEdit = useCallback(async (messageId: string, text: string) => {
    try {
      const res = await fetch(`/api/whatsapp/messages/${messageId}/edit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(payload?.error || t("actions.editError"));
        return;
      }
    } catch (err) {
      console.error("Failed to edit message:", err);
      toast.error(t("actions.editError"));
    }
  }, [t]);
```

No loop de renderização, ao lado de `canDeleteMsg` (Task 5, Step 8):

```ts
                    const canEditMsg =
                      isOwnAndNotDeleted &&
                      msg.content_type === "text" &&
                      threadChannel?.provider === "uazapi" &&
                      (msg.sender_id === user?.id || canEditSettings);
```

E passar pra `MessageActions`:

```ts
                        onEdit={canEditMsg ? () => handleStartEdit(msg) : undefined}
```

Passar os novos props pro `<MessageComposer>` (perto de `replyTo={replyTo}`,
linha ~1357):

```tsx
        editingMessage={editingMessage}
        onSubmitEdit={handleSubmitEdit}
        onCancelEdit={() => setEditingMessage(null)}
```

Adicionar `"editError": "Não foi possível editar a mensagem"` em
`Inbox.actions` nos três arquivos de tradução.

- [ ] **Step 5: Rodar a suíte de inbox e ver tudo passar**

Run: `npx vitest run src/components/inbox/ src/app/\(dashboard\)/inbox/`
Expected: PASS.

- [ ] **Step 6: Verificar que compila**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 7: Rodar a suíte inteira**

Run: `npx vitest run`
Expected: PASS, exceto a flakiness de locale/timezone já conhecida e não
relacionada (`currency.test.ts`, `date-utils.test.ts` — ver memória de
sessão, cada arquivo passa isolado).

- [ ] **Step 8: Commit**

```bash
git add src/components/inbox/ messages/pt.json messages/en.json messages/ko.json
git commit -m "feat(mensagens): UI de editar mensagem propria (modo edicao no composer)"
```

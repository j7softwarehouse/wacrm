# Grupos de WhatsApp — Fase 1 (fundação + leitura) — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer o CRM exibir, na inbox, as mensagens dos grupos de WhatsApp que o usuário explicitamente habilitar — sem que grupos disparem automações, fluxos ou IA, e sem que participantes virem contatos.

**Architecture:** Grupo vira entidade própria (`whatsapp_groups`), não um contato com flag. `conversations.contact_id` passa a ser nullable e ganha `group_id`, com um `CHECK` garantindo exatamente um dos dois. Participantes vivem em `group_participants`, fora de `contacts`. O webhook da uazapi para de filtrar grupos no servidor, e `ingest.ts` ganha uma trava que impede grupo de acionar os motores.

**Tech Stack:** Next.js (App Router), TypeScript, Supabase (Postgres + RLS + Storage), Vitest, uazapi (provider WhatsApp via Baileys).

**Spec:** `docs/superpowers/specs/2026-08-28-grupos-whatsapp-fase1-design.md`

## Global Constraints

- **Trava de motores é obrigatória e vem antes da UI.** Mensagem de grupo nunca dispara `dispatchInboundToFlows`, `runAutomationsForTrigger` nem resposta automática de IA. É a falha mais cara da fase: mensagem indevida já foi entregue a terceiros.
- **Participante nunca vira `contacts`.** Nenhuma tarefa pode inserir participante de grupo na base de contatos.
- **Atendimento 1:1 não pode regredir.** Toda tarefa que toca caminho compartilhado roda a suíte completa antes do commit.
- **Migrations não aplicam sozinhas.** A integração Supabase→GitHub aponta para `main`, abandonada. Toda migration desta fase é aplicada à mão em homologação (`mpwjlshxfxfvysoeyyzy`) e depois em produção (`jynplnaslifzftyhasna`).
- **`isGroupNo` remove conversas INDIVIDUAIS.** A nomenclatura da uazapi é invertida; trocar `isGroupYes` por `isGroupNo` derruba o atendimento 1:1. Ver `connection.test.ts`.
- **Nomenclatura de migration:** `supabase/migrations/AAAAMMDD0000NN_<nome>.sql`.
- **Comentários e mensagens de commit em português**, seguindo o padrão do repositório.

---

## File Structure

**Criados:**
- `supabase/migrations/20260829000001_whatsapp_groups.sql` — as três mudanças de schema (tabelas novas + alteração em `conversations`/`messages`) numa migration só, porque são um único passo lógico e devem falhar juntas.
- `src/lib/whatsapp/groups/resolve-group-conversation.ts` — encontra/cria a conversa de um grupo e faz upsert do participante. Espelha `resolve-conversation.ts`, que serve o caminho 1:1.
- `src/lib/whatsapp/groups/resolve-group-conversation.test.ts`
- `src/app/api/whatsapp/groups/route.ts` — lista grupos e alterna `enabled`.
- `src/app/api/whatsapp/groups/sync/route.ts` — busca grupos na uazapi e faz upsert.
- `src/components/settings/groups-manager.tsx` — aba de seleção de grupos.

**Modificados:**
- `src/lib/whatsapp/uazapi/normalize.ts` — para de descartar grupo; passa a extrair `group`.
- `src/lib/whatsapp/uazapi/connection.ts` — remove `isGroupYes` de `excludeMessages`.
- `src/lib/whatsapp/inbound/ingest.ts` — trava dos motores + caminho de grupo.
- `src/app/api/whatsapp/uazapi/webhook/[...secret]/route.ts` — encaminha `group`.
- `src/lib/whatsapp/providers/uazapi.ts` + `providers/types.ts` — método `listGroups`.
- `src/components/inbox/message-bubble.tsx` — autor do participante.
- `src/components/settings/settings-overview.tsx` — entrada da aba.
- `messages/pt.json`, `messages/en.json`, `messages/ko.json` — textos.

**Ordem:** schema → normalização → trava → ingestão → API → UI. A trava (Tarefa 3) vem antes de qualquer coisa que faça grupo chegar na inbox.

---

### Task 1: Schema — tabelas de grupo e participante

**Files:**
- Create: `supabase/migrations/20260829000001_whatsapp_groups.sql`

**Interfaces:**
- Consumes: tabelas existentes `accounts`, `whatsapp_channels`, `conversations`, `messages`.
- Produces: tabelas `whatsapp_groups`, `group_participants`; colunas `conversations.group_id`, `messages.participant_id`; `conversations.contact_id` nullable.

- [ ] **Step 1: Escrever a migration**

```sql
-- ============================================================
-- 20260829000001_whatsapp_groups
--
-- Grupos de WhatsApp como entidade própria. A alternativa —
-- representar o grupo como uma linha em `contacts` com o JID no
-- campo `phone` — contaminaria base de contatos, funil, tags e
-- dashboard, que assumem "contato = pessoa".
-- ============================================================

CREATE TABLE IF NOT EXISTS whatsapp_groups (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  channel_id UUID NOT NULL REFERENCES whatsapp_channels(id) ON DELETE CASCADE,
  group_jid  TEXT NOT NULL,
  name       TEXT,
  avatar_url TEXT,
  -- Opt-in explícito: o número conectado costuma estar em grupos
  -- pessoais que não podem poluir a inbox.
  enabled    BOOLEAN NOT NULL DEFAULT FALSE,
  synced_at  TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (account_id, channel_id, group_jid)
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_groups_account
  ON whatsapp_groups(account_id);

CREATE TABLE IF NOT EXISTS group_participants (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  group_id        UUID NOT NULL REFERENCES whatsapp_groups(id) ON DELETE CASCADE,
  -- Pode ser @s.whatsapp.net OU @lid (identificador opaco, sem telefone).
  participant_jid TEXT NOT NULL,
  phone           TEXT,
  display_name    TEXT,
  first_seen_at   TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (group_id, participant_jid)
);

CREATE INDEX IF NOT EXISTS idx_group_participants_group
  ON group_participants(group_id);

-- Conversa passa a ser OU 1:1 OU de grupo, nunca ambos nem nenhum.
ALTER TABLE conversations
  ALTER COLUMN contact_id DROP NOT NULL;

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS group_id UUID
    REFERENCES whatsapp_groups(id) ON DELETE CASCADE;

ALTER TABLE conversations
  DROP CONSTRAINT IF EXISTS conversations_contact_xor_group;
ALTER TABLE conversations
  ADD CONSTRAINT conversations_contact_xor_group
    CHECK (num_nonnulls(contact_id, group_id) = 1);

CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_account_group_channel
  ON conversations (account_id, group_id, channel_id) NULLS NOT DISTINCT;

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS participant_id UUID
    REFERENCES group_participants(id) ON DELETE SET NULL;

ALTER TABLE whatsapp_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_participants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS whatsapp_groups_all ON whatsapp_groups;
CREATE POLICY whatsapp_groups_all ON whatsapp_groups FOR ALL
  USING (is_account_member(account_id));

DROP POLICY IF EXISTS group_participants_all ON group_participants;
CREATE POLICY group_participants_all ON group_participants FOR ALL
  USING (EXISTS (
    SELECT 1 FROM whatsapp_groups g
    WHERE g.id = group_participants.group_id
      AND is_account_member(g.account_id)
  ));
```

- [ ] **Step 2: Aplicar em homologação e verificar**

Rodar o SQL acima no projeto `mpwjlshxfxfvysoeyyzy` (SQL Editor do Supabase). Depois verificar:

```sql
SELECT conname FROM pg_constraint WHERE conname = 'conversations_contact_xor_group';
SELECT is_nullable FROM information_schema.columns
  WHERE table_name = 'conversations' AND column_name = 'contact_id';
```

Esperado: a constraint existe; `is_nullable = YES`.

- [ ] **Step 3: Verificar que o CHECK realmente barra estado inválido**

`conversations.account_id` e `conversations.user_id` são `NOT NULL` com FK para `accounts`/`auth.users` — um UUID fictício nesses campos falharia por violação de FK, não pela `CHECK`, e provaria a coisa errada. Por isso o teste usa uma conta e um usuário reais já existentes, dentro de uma transação desfeita no final (não deixa lixo no banco):

```sql
BEGIN;

-- Pega um account_id e um user_id reais já existentes no ambiente.
-- (rodar antes, à parte, e usar os valores devolvidos abaixo)
SELECT id AS account_id FROM accounts LIMIT 1;
SELECT user_id FROM profiles LIMIT 1;

-- Deve FALHAR com violação da constraint (usar os UUIDs reais obtidos acima):
INSERT INTO conversations (account_id, user_id, contact_id, group_id)
VALUES ('<account_id real>', '<user_id real>', NULL, NULL);

ROLLBACK;
```

Esperado: erro `violates check constraint "conversations_contact_xor_group"`. Se o insert passar, a constraint não está ativa — parar e investigar antes de seguir. O `ROLLBACK` garante que nada fica gravado mesmo que o teste passe.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260829000001_whatsapp_groups.sql
git commit -m "feat(grupos): schema de whatsapp_groups e group_participants"
```

---

### Task 2: Levantar e blindar os call sites de `contact_id`

Soltar o `NOT NULL` de `conversations.contact_id` afeta todo código que assume contato presente. Esta tarefa existe para descobrir isso **antes** de qualquer grupo entrar no sistema, não durante.

**Files:**
- Modify: os arquivos que o levantamento apontar
- Test: `src/lib/whatsapp/groups/contact-nullable.test.ts` (criar)

**Interfaces:**
- Consumes: schema da Tarefa 1.
- Produces: nenhuma API nova; garante que o código existente tolera `contact_id` nulo.

- [ ] **Step 1: Levantar os call sites**

```bash
grep -rn "contact_id" src/ --include=*.ts --include=*.tsx | grep -v test | grep -v "\.d\.ts"
grep -rn "contact:contacts\|contacts(" src/ --include=*.ts --include=*.tsx | grep -v test
```

Anotar cada ocorrência que assume contato presente (acesso tipo `conversation.contact.phone` sem checagem). Colar a lista no corpo do commit desta tarefa.

- [ ] **Step 2: Escrever o teste que falha**

Cria `src/lib/whatsapp/groups/contact-nullable.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { sendMessageToConversation, SendMessageError } from '@/lib/whatsapp/send-message';

describe('caminhos 1:1 diante de conversa de grupo', () => {
  it('sendMessageToConversation recusa conversa sem contato', async () => {
    // Fase 1 nao envia em grupo. O envio precisa recusar com erro
    // claro em vez de estourar em `contact.phone` de undefined.
    const db = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              single: async () => ({
                data: {
                  id: 'cv-1',
                  account_id: 'acct-1',
                  contact_id: null,
                  group_id: 'grp-1',
                  contact: null,
                },
                error: null,
              }),
            }),
          }),
        }),
      }),
    } as unknown as SupabaseClient;

    await expect(
      sendMessageToConversation(db, 'acct-1', {
        conversationId: 'cv-1',
        messageType: 'text',
        contentText: 'oi',
      }),
    ).rejects.toBeInstanceOf(SendMessageError);
  });
});
```

- [ ] **Step 3: Rodar e confirmar o comportamento atual**

Run: `npx vitest run src/lib/whatsapp/groups/contact-nullable.test.ts`

`send-message.ts` já tem `if (!contact?.phone) throw new SendMessageError(...)`, então este teste **pode passar de primeira**. Se passar, é caracterização — anotar isso no commit e seguir. Se falhar, corrigir o call site no passo seguinte.

- [ ] **Step 4: Corrigir os call sites que quebram**

Para cada ocorrência do levantamento que estourar com contato nulo, adicionar guarda explícita. Padrão a seguir (o mesmo que `send-message.ts` já usa):

```typescript
const contact = conversation.contact;
if (!contact?.phone) {
  throw new SendMessageError('bad_request', 'Contact phone number not found', 400);
}
```

Em componentes de UI, preferir não renderizar a seção dependente de contato a renderizar vazio.

- [ ] **Step 5: Rodar a suíte completa**

Run: `npx vitest run`
Esperado: nenhuma regressão nova. As falhas conhecidas de `date-utils` e formatação de moeda são pré-existentes (sensíveis a locale da máquina) e não contam.

- [ ] **Step 6: Commit**

```bash
git add src/
git commit -m "fix(grupos): tolera contact_id nulo nos caminhos 1:1"
```

---

### Task 3: Trava dos motores (automações, fluxos, IA)

Vem **antes** de qualquer coisa que faça grupo chegar na inbox. Sem ela, ligar grupos faz o bot responder dentro de grupos — inclusive pessoais.

**Files:**
- Modify: `src/lib/whatsapp/inbound/ingest.ts`
- Test: `src/lib/whatsapp/inbound/ingest.groups.test.ts` (criar)

**Interfaces:**
- Consumes: `IngestParams` existente.
- Produces: `IngestParams.group?: { groupJid: string; participantJid: string; participantName?: string }` — consumido pelas Tarefas 4 e 5.

- [ ] **Step 1: Escrever o teste que falha**

Cria `src/lib/whatsapp/inbound/ingest.groups.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  dispatchInboundToFlows: vi.fn(),
  runAutomationsForTrigger: vi.fn(),
}));

vi.mock('@/lib/flows/engine', () => ({
  dispatchInboundToFlows: mocks.dispatchInboundToFlows,
}));
vi.mock('@/lib/automations/engine', () => ({
  runAutomationsForTrigger: mocks.runAutomationsForTrigger,
}));

import { shouldDispatchEngines } from './ingest';

describe('shouldDispatchEngines', () => {
  beforeEach(() => vi.clearAllMocks());

  it('permite disparo em mensagem 1:1', () => {
    expect(shouldDispatchEngines({ group: undefined })).toBe(true);
  });

  it('BLOQUEIA disparo em mensagem de grupo', () => {
    // Sem esta trava o bot responde dentro de grupos — inclusive
    // grupos pessoais do numero conectado. A mensagem indevida ja
    // foi entregue a terceiros quando o erro aparece; nao ha desfazer.
    expect(
      shouldDispatchEngines({
        group: {
          groupJid: '123@g.us',
          participantJid: '5511999999999@s.whatsapp.net',
        },
      }),
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run src/lib/whatsapp/inbound/ingest.groups.test.ts`
Esperado: FAIL — `shouldDispatchEngines` não existe.

- [ ] **Step 3: Implementar**

Em `src/lib/whatsapp/inbound/ingest.ts`, adicionar o campo em `IngestParams`:

```typescript
export interface IngestParams {
  channel: WhatsAppChannel;
  from: string;
  pushName?: string;
  providerMessageId: string;
  timestamp: number;
  content: InboundContent;
  replyToProviderMessageId?: string;
  /**
   * Presente só quando a mensagem veio de um grupo. Ausente = 1:1,
   * exatamente como antes — o caminho existente não muda.
   */
  group?: {
    groupJid: string;
    participantJid: string;
    participantName?: string;
  };
}
```

E a função de decisão, exportada para ser testável isoladamente:

```typescript
/**
 * Mensagem de grupo NUNCA aciona flows, automations ou resposta
 * automática de IA. Fase 1 é leitura; um motor respondendo dentro de
 * um grupo é o pior erro possível desta entrega, porque a mensagem
 * indevida chega a terceiros e não há como desfazer.
 */
export function shouldDispatchEngines(params: {
  group?: { groupJid: string; participantJid: string; participantName?: string };
}): boolean {
  return !params.group;
}
```

- [ ] **Step 4: Aplicar a trava no dispatch**

Em `ingestInboundMessage`, localizar a linha `await flagBroadcastReplyIfAny(db, accountId, contactRecord.id);` (por volta da linha 640) e envolver dali até o fim do bloco de automations num condicional. Grupo também não marca resposta de broadcast, então a trava começa antes dessa chamada:

```typescript
  // Grupo nunca aciona os motores. Ver `shouldDispatchEngines`.
  if (shouldDispatchEngines(params)) {
    await flagBroadcastReplyIfAny(db, accountId, contactRecord.id);

    // ... todo o bloco existente de flows + automations permanece
    // aqui dentro, sem alteração de conteúdo, apenas indentado.
  }
```

Não alterar a lógica interna do bloco — só envolvê-la. A Tarefa 7 vai fazer grupo tomar um caminho separado que nem chega aqui; esta trava permanece como defesa em profundidade, e é ela que o teste do Step 1 verifica.

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `npx vitest run src/lib/whatsapp/inbound/ingest.groups.test.ts`
Esperado: PASS (2 testes).

- [ ] **Step 6: Rodar a suíte completa**

Run: `npx vitest run`
Esperado: nenhuma regressão nova no caminho 1:1.

- [ ] **Step 7: Commit**

```bash
git add src/lib/whatsapp/inbound/ingest.ts src/lib/whatsapp/inbound/ingest.groups.test.ts
git commit -m "feat(grupos): trava que impede grupo de acionar flows, automations e IA"
```

---

### Task 4: Normalização — extrair grupo e participante do evento

**Files:**
- Modify: `src/lib/whatsapp/uazapi/normalize.ts`
- Test: `src/lib/whatsapp/uazapi/normalize.test.ts:90` (o teste que hoje espera descarte)

**Interfaces:**
- Consumes: nada de tarefas anteriores.
- Produces: `NormalizedInbound.group?: { groupJid: string; participantJid: string; participantName?: string }` — consumido pela Tarefa 6.

- [ ] **Step 1: Escrever o teste que falha**

Substituir o teste existente em `normalize.test.ts` (hoje ele afirma que grupo vira `null`) e acrescentar:

```typescript
it('extrai grupo e participante em vez de descartar', () => {
  const evento = {
    ...eventoReal,
    message: {
      ...eventoReal.message,
      isGroup: true,
      chatid: '120363000000000000@g.us',
      sender_pn: '5511999999999@s.whatsapp.net',
      senderName: 'Fulano',
    },
  };

  const r = normalizeUazapiEvent(evento);

  expect(r).not.toBeNull();
  expect(r!.group).toEqual({
    groupJid: '120363000000000000@g.us',
    participantJid: '5511999999999@s.whatsapp.net',
    participantName: 'Fulano',
  });
  // Em grupo o remetente e o PARTICIPANTE, nunca o JID do grupo.
  expect(r!.from).toBe('5511999999999');
});

it('mensagem 1:1 continua sem o campo group', () => {
  const r = normalizeUazapiEvent(eventoReal);
  expect(r).not.toBeNull();
  expect(r!.group).toBeUndefined();
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run src/lib/whatsapp/uazapi/normalize.test.ts`
Esperado: FAIL — hoje retorna `null` para grupo.

- [ ] **Step 3: Implementar**

Em `normalize.ts`, acrescentar ao tipo:

```typescript
export interface NormalizedInbound {
  from: string;
  pushName?: string;
  providerMessageId: string;
  timestamp: number;
  content: InboundContent;
  replyToProviderMessageId?: string;
  /** Presente só em mensagem de grupo. Ausente = 1:1. */
  group?: {
    groupJid: string;
    participantJid: string;
    participantName?: string;
  };
}
```

Trocar o descarte da linha 116. Remover `if (d.isGroup === true) return null;` e, depois da resolução de `from`, montar o bloco:

```typescript
// Em grupo, `chatid` é o JID DO GRUPO — não serve como identidade do
// remetente. O participante tem que sair de `sender_pn`/`sender`, e
// quando só houver @lid ficamos sem telefone (por isso
// `group_participants.phone` é nulável).
const isGroup = d.isGroup === true;
const groupJid = isGroup ? asString(d.chatid) : undefined;
const participantJid = isGroup
  ? (asString(d.sender_pn) ?? asString(d.sender))
  : undefined;

const group =
  groupJid && participantJid
    ? {
        groupJid,
        participantJid,
        participantName: asString(d.senderName) ?? asString(d.pushName),
      }
    : undefined;

// Grupo sem participante identificável é descartado: sem autor a
// mensagem viraria um balão anônimo na thread.
if (isGroup && !group) return null;
```

Adicionar o helper, se ainda não existir:

```typescript
function asString(v: unknown): string | undefined {
  return typeof v === 'string' && v ? v : undefined;
}
```

⚠️ A resolução de `from` em grupo deve usar `sender_pn`/`sender`, **nunca** `chatid` — em grupo `chatid` é o JID do grupo e gravaria o grupo como se fosse o remetente. Ajustar a cadeia de fallback para pular `chatid` quando `isGroup`.

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run src/lib/whatsapp/uazapi/normalize.test.ts`
Esperado: PASS, incluindo os testes 1:1 que já existiam.

- [ ] **Step 5: Commit**

```bash
git add src/lib/whatsapp/uazapi/normalize.ts src/lib/whatsapp/uazapi/normalize.test.ts
git commit -m "feat(grupos): normalize extrai grupo e participante do evento"
```

---

### Task 5: Resolver conversa de grupo e participante

**Files:**
- Create: `src/lib/whatsapp/groups/resolve-group-conversation.ts`
- Test: `src/lib/whatsapp/groups/resolve-group-conversation.test.ts`

**Interfaces:**
- Consumes: schema da Tarefa 1.
- Produces:
  - `resolveGroupConversation(db: SupabaseClient, accountId: string, channelId: string, userId: string, group: { groupJid: string; participantJid: string; participantName?: string }): Promise<ResolvedGroupConversation | null>`
  - `interface ResolvedGroupConversation { conversationId: string; groupId: string; participantId: string }`
  - Retorna `null` quando o grupo não está habilitado.

- [ ] **Step 1: Escrever o teste que falha**

```typescript
import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { resolveGroupConversation } from './resolve-group-conversation';

const GROUP = {
  groupJid: '120363000000000000@g.us',
  participantJid: '5511999999999@s.whatsapp.net',
  participantName: 'Fulano',
};

function fakeDb(opts: {
  group: { id: string; enabled: boolean } | null;
  inserted: Record<string, unknown[]>;
}) {
  const inserted = opts.inserted;
  return {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: table === 'whatsapp_groups' ? opts.group : null,
                error: null,
              }),
            }),
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        }),
      }),
      insert: (row: Record<string, unknown>) => {
        (inserted[table] ??= []).push(row);
        return {
          select: () => ({
            single: async () => ({ data: { id: `${table}-1`, ...row }, error: null }),
          }),
        };
      },
      update: () => ({ eq: async () => ({ error: null }) }),
    }),
  } as unknown as SupabaseClient;
}

describe('resolveGroupConversation', () => {
  it('registra o grupo desconhecido como desabilitado e NAO cria conversa', async () => {
    // Assim a tela de selecao descobre os grupos existentes sem que
    // eles apareçam na inbox antes de alguem autorizar.
    const inserted: Record<string, unknown[]> = {};
    const db = fakeDb({ group: null, inserted });

    const r = await resolveGroupConversation(db, 'acct-1', 'ch-1', 'user-1', GROUP);

    expect(r).toBeNull();
    expect(inserted['whatsapp_groups']?.[0]).toMatchObject({
      group_jid: GROUP.groupJid,
      enabled: false,
    });
    expect(inserted['conversations']).toBeUndefined();
  });

  it('descarta mensagem de grupo conhecido porem desabilitado', async () => {
    const inserted: Record<string, unknown[]> = {};
    const db = fakeDb({ group: { id: 'grp-1', enabled: false }, inserted });

    const r = await resolveGroupConversation(db, 'acct-1', 'ch-1', 'user-1', GROUP);

    expect(r).toBeNull();
    expect(inserted['conversations']).toBeUndefined();
  });

  it('cria conversa e participante quando o grupo esta habilitado', async () => {
    const inserted: Record<string, unknown[]> = {};
    const db = fakeDb({ group: { id: 'grp-1', enabled: true }, inserted });

    const r = await resolveGroupConversation(db, 'acct-1', 'ch-1', 'user-1', GROUP);

    expect(r).not.toBeNull();
    expect(r!.groupId).toBe('grp-1');
    // Conversa de grupo tem contact_id nulo — o CHECK do banco exige
    // exatamente um entre contact_id e group_id.
    expect(inserted['conversations']?.[0]).toMatchObject({
      group_id: 'grp-1',
      contact_id: null,
    });
    expect(inserted['group_participants']?.[0]).toMatchObject({
      participant_jid: GROUP.participantJid,
      phone: '5511999999999',
    });
  });

  it('grava phone nulo quando o participante e @lid', async () => {
    // O WhatsApp entrega participantes como @lid (identificador opaco,
    // sem telefone) cada vez mais. Gravar o LID como telefone criaria
    // contato/numero falso.
    const inserted: Record<string, unknown[]> = {};
    const db = fakeDb({ group: { id: 'grp-1', enabled: true }, inserted });

    await resolveGroupConversation(db, 'acct-1', 'ch-1', 'user-1', {
      ...GROUP,
      participantJid: '98765432100000@lid',
    });

    expect(inserted['group_participants']?.[0]).toMatchObject({ phone: null });
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run src/lib/whatsapp/groups/resolve-group-conversation.test.ts`
Esperado: FAIL — módulo não existe.

- [ ] **Step 3: Implementar**

```typescript
// ============================================================
// Resolve a conversa de um grupo e o participante que escreveu.
//
// Espelha `resolve-conversation.ts`, que serve o caminho 1:1. A
// diferença central: grupo é opt-in. Grupo desconhecido é registrado
// desabilitado e a mensagem é descartada, para a tela de seleção
// descobrir o que existe sem poluir a inbox.
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';

export interface ResolvedGroupConversation {
  conversationId: string;
  groupId: string;
  participantId: string;
}

/** `5511999999999@s.whatsapp.net` → `5511999999999`; `...@lid` → null. */
export function phoneFromParticipantJid(jid: string): string | null {
  if (!jid.endsWith('@s.whatsapp.net')) return null;
  const [user] = jid.split('@');
  if (!user) return null;
  const [phone] = user.split(':');
  return phone || null;
}

export async function resolveGroupConversation(
  db: SupabaseClient,
  accountId: string,
  channelId: string,
  userId: string,
  group: { groupJid: string; participantJid: string; participantName?: string },
): Promise<ResolvedGroupConversation | null> {
  const { data: existing } = await db
    .from('whatsapp_groups')
    .select('id, enabled')
    .eq('account_id', accountId)
    .eq('channel_id', channelId)
    .eq('group_jid', group.groupJid)
    .maybeSingle();

  let groupId: string;
  let enabled: boolean;

  if (!existing) {
    const { data: created, error } = await db
      .from('whatsapp_groups')
      .insert({
        account_id: accountId,
        channel_id: channelId,
        group_jid: group.groupJid,
        enabled: false,
      })
      .select('id')
      .single();
    if (error || !created) return null;
    groupId = created.id;
    enabled = false;
  } else {
    groupId = existing.id;
    enabled = existing.enabled;
  }

  // Grupo não habilitado: já está registrado para a tela de seleção,
  // mas a mensagem não entra na inbox.
  if (!enabled) return null;

  const { data: participant } = await db
    .from('group_participants')
    .insert({
      group_id: groupId,
      participant_jid: group.participantJid,
      phone: phoneFromParticipantJid(group.participantJid),
      display_name: group.participantName ?? null,
    })
    .select('id')
    .single();

  const { data: conversation } = await db
    .from('conversations')
    .insert({
      account_id: accountId,
      user_id: userId,
      contact_id: null,
      group_id: groupId,
      channel_id: channelId,
    })
    .select('id')
    .single();

  if (!participant || !conversation) return null;

  return {
    conversationId: conversation.id,
    groupId,
    participantId: participant.id,
  };
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run src/lib/whatsapp/groups/resolve-group-conversation.test.ts`
Esperado: PASS (4 testes).

- [ ] **Step 5: Commit**

```bash
git add src/lib/whatsapp/groups/
git commit -m "feat(grupos): resolve conversa de grupo e participante"
```

> **Nota para quem executar:** o upsert real (`ON CONFLICT`) de grupo, participante e conversa é o passo seguinte natural, mas depende de comportamento do PostgREST que os fakes não reproduzem. Validar contra o banco de homologação antes de considerar a Tarefa 5 concluída: mandar duas mensagens do mesmo participante e conferir que `group_participants` tem **uma** linha e `conversations` tem **uma** linha para o grupo.

---

### Task 6: Ligar o webhook — parar de filtrar grupo

**Files:**
- Modify: `src/lib/whatsapp/uazapi/connection.ts:108`
- Modify: `src/app/api/whatsapp/uazapi/webhook/[...secret]/route.ts:230`
- Test: `src/lib/whatsapp/uazapi/connection.test.ts:82`

**Interfaces:**
- Consumes: `NormalizedInbound.group` (Tarefa 4), `IngestParams.group` (Tarefa 3).
- Produces: mensagens de grupo chegando em `ingestInboundMessage`.

- [ ] **Step 1: Atualizar o teste da configuração do webhook**

Em `connection.test.ts`, substituir o teste que hoje exige `isGroupYes`:

```typescript
it('nao exclui mais grupos, mas segue excluindo eco de envio', () => {
  const config = buildWebhookConfig('https://exemplo.com/hook');
  // CUIDADO: na UAZAPI `isGroupNo` remove conversas INDIVIDUAIS.
  // Nenhum dos dois deve aparecer — grupo agora entra, e o 1:1
  // nunca pode ser filtrado.
  expect(config.excludeMessages).not.toContain('isGroupYes');
  expect(config.excludeMessages).not.toContain('isGroupNo');
  expect(config.excludeMessages).toContain('wasSentByApi');
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run src/lib/whatsapp/uazapi/connection.test.ts`
Esperado: FAIL — `isGroupYes` ainda está na lista.

- [ ] **Step 3: Implementar**

Em `connection.ts`, na função `buildWebhookConfig`:

```typescript
    // `wasSentByApi` continua excluído para não reprocessarmos o eco
    // dos nossos próprios envios. Grupo NÃO é mais filtrado aqui — o
    // opt-in acontece no nosso lado (`whatsapp_groups.enabled`), o
    // que dá controle por grupo em vez de tudo-ou-nada.
    excludeMessages: ["wasSentByApi"],
```

- [ ] **Step 4: Encaminhar `group` na rota do webhook**

Em `src/app/api/whatsapp/uazapi/webhook/[...secret]/route.ts`, na chamada a `ingestInboundMessage` (por volta da linha 230), acrescentar o campo:

```typescript
  await ingestInboundMessage(supabaseAdmin(), {
    channel,
    from: normalized.from,
    pushName: normalized.pushName,
    providerMessageId: normalized.providerMessageId,
    timestamp: normalized.timestamp,
    content,
    replyToProviderMessageId: normalized.replyToProviderMessageId,
    group: normalized.group,
  });
```

- [ ] **Step 5: Rodar a suíte completa**

Run: `npx vitest run`
Esperado: PASS, sem regressão no 1:1.

- [ ] **Step 6: Re-registrar a config na instância uazapi**

Mudar o código **não basta**: o filtro vive no servidor da uazapi. Re-registrar o webhook do canal pela UI de canais (desconectar/reconectar ou acionar a ação de salvar configuração), e confirmar:

```bash
curl -s -H "token: <token do canal>" https://j7softwarehouse.uazapi.com/webhook
```

Esperado: `excludeMessages` sem `isGroupYes`. Se ainda aparecer, o re-registro não aconteceu — mensagens de grupo continuarão sem chegar.

- [ ] **Step 7: Commit**

```bash
git add src/lib/whatsapp/uazapi/connection.ts src/lib/whatsapp/uazapi/connection.test.ts "src/app/api/whatsapp/uazapi/webhook/[...secret]/route.ts"
git commit -m "feat(grupos): webhook para de filtrar grupos e encaminha participante"
```

---

### Task 7: Ingestão — gravar mensagem de grupo

**Files:**
- Modify: `src/lib/whatsapp/inbound/ingest.ts`
- Test: `src/lib/whatsapp/inbound/ingest.groups.test.ts` (acrescentar)

**Interfaces:**
- Consumes: `resolveGroupConversation` (Tarefa 5), `IngestParams.group` (Tarefa 3).
- Produces: linha em `messages` com `participant_id` e `sender_type = 'customer'`.

- [ ] **Step 1: Escrever o teste que falha**

Acrescentar em `ingest.groups.test.ts`:

Acrescentar o mock de `resolveGroupConversation` no topo do arquivo, junto dos mocks já existentes:

```typescript
const mocks = vi.hoisted(() => ({
  dispatchInboundToFlows: vi.fn(),
  runAutomationsForTrigger: vi.fn(),
  resolveGroupConversation: vi.fn(),
}));

vi.mock('@/lib/whatsapp/groups/resolve-group-conversation', () => ({
  resolveGroupConversation: mocks.resolveGroupConversation,
}));
```

E os testes:

```typescript
import { ingestInboundMessage } from './ingest';
import type { SupabaseClient } from '@supabase/supabase-js';

const CANAL = {
  id: 'ch-1',
  account_id: 'acct-1',
  user_id: 'user-1',
  provider: 'uazapi',
  status: 'connected',
} as never;

const GRUPO = {
  groupJid: '120363000000000000@g.us',
  participantJid: '5511999999999@s.whatsapp.net',
};

/** Captura inserts por tabela e devolve linhas com id previsível. */
function fakeDb(porTabela: Record<string, Record<string, unknown>[]>) {
  return {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
            single: async () => ({ data: null, error: null }),
          }),
          maybeSingle: async () => ({ data: null, error: null }),
        }),
      }),
      insert: (row: Record<string, unknown>) => {
        (porTabela[table] ??= []).push(row);
        return {
          select: () => ({
            single: async () => ({ data: { id: `${table}-1`, ...row }, error: null }),
          }),
        };
      },
      update: () => ({ eq: async () => ({ error: null }) }),
    }),
  } as unknown as SupabaseClient;
}

describe('ingestInboundMessage — mensagem de grupo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveGroupConversation.mockResolvedValue({
      conversationId: 'cv-1',
      groupId: 'grp-1',
      participantId: 'p-1',
    });
  });

  it('grava mensagem de grupo com participant_id e sender_type customer', async () => {
    // sender_type continua 'customer': quem fala nao e da nossa equipe.
    // Nao se cria valor novo no enum para nao quebrar consumidores.
    const porTabela: Record<string, Record<string, unknown>[]> = {};

    await ingestInboundMessage(fakeDb(porTabela), {
      channel: CANAL,
      from: '5511999999999',
      providerMessageId: 'wamid-1',
      timestamp: Math.floor(Date.now() / 1000),
      content: { type: 'text', text: 'oi grupo' },
      group: GRUPO,
    });

    expect(porTabela['messages']?.[0]).toMatchObject({
      conversation_id: 'cv-1',
      sender_type: 'customer',
      participant_id: 'p-1',
      content_text: 'oi grupo',
    });
  });

  it('NAO cria contato para participante de grupo', async () => {
    // Requisito duro: participante nunca entra na base de contatos.
    const porTabela: Record<string, Record<string, unknown>[]> = {};

    await ingestInboundMessage(fakeDb(porTabela), {
      channel: CANAL,
      from: '5511999999999',
      providerMessageId: 'wamid-2',
      timestamp: Math.floor(Date.now() / 1000),
      content: { type: 'text', text: 'oi' },
      group: GRUPO,
    });

    expect(porTabela['contacts']).toBeUndefined();
  });

  it('descarta quando o grupo nao esta habilitado', async () => {
    mocks.resolveGroupConversation.mockResolvedValue(null);
    const porTabela: Record<string, Record<string, unknown>[]> = {};

    const r = await ingestInboundMessage(fakeDb(porTabela), {
      channel: CANAL,
      from: '5511999999999',
      providerMessageId: 'wamid-3',
      timestamp: Math.floor(Date.now() / 1000),
      content: { type: 'text', text: 'oi' },
      group: GRUPO,
    });

    expect(r).toBeNull();
    expect(porTabela['messages']).toBeUndefined();
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run src/lib/whatsapp/inbound/ingest.groups.test.ts`
Esperado: FAIL — hoje `ingestInboundMessage` sempre chama `findOrCreateContact`.

- [ ] **Step 3: Implementar**

No início de `ingestInboundMessage`, antes de `findOrCreateContact`, ramificar:

```typescript
  // Grupo tem caminho próprio: não há contato a criar, e o
  // participante mora em `group_participants`.
  if (params.group) {
    const resolved = await resolveGroupConversation(
      db,
      accountId,
      channel.id,
      configOwnerUserId,
      params.group,
    );
    // Grupo não habilitado (ou recém-descoberto): nada entra na inbox.
    if (!resolved) return null;

    return await ingestGroupMessage(db, params, resolved);
  }
```

E a função dedicada, que grava a mensagem e atualiza a conversa, sem tocar em `contacts`:

```typescript
async function ingestGroupMessage(
  db: SupabaseClient,
  params: IngestParams,
  resolved: ResolvedGroupConversation,
): Promise<IngestResult | null> {
  const { data: message, error } = await db
    .from('messages')
    .insert({
      conversation_id: resolved.conversationId,
      sender_type: 'customer',
      participant_id: resolved.participantId,
      content_type: params.content.type,
      content_text: params.content.text ?? null,
      media_url: params.content.mediaUrl ?? null,
      message_id: params.providerMessageId,
      status: 'received',
    })
    .select('id')
    .single();

  if (error || !message) return null;

  await db
    .from('conversations')
    .update({
      last_message_text: buildConversationPreview(params.content),
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', resolved.conversationId);

  return {
    messageId: message.id,
    conversationId: resolved.conversationId,
    // Conversa de grupo não tem contato — o campo existe no contrato
    // por causa do caminho 1:1.
    contactId: '',
    deduped: false,
  };
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run src/lib/whatsapp/inbound/ingest.groups.test.ts`
Esperado: PASS.

- [ ] **Step 5: Rodar a suíte completa**

Run: `npx vitest run`

- [ ] **Step 6: Commit**

```bash
git add src/lib/whatsapp/inbound/ingest.ts src/lib/whatsapp/inbound/ingest.groups.test.ts
git commit -m "feat(grupos): grava mensagem de grupo sem criar contato"
```

---

### Task 8: Provider — listar grupos na uazapi

**Files:**
- Modify: `src/lib/whatsapp/providers/types.ts`
- Modify: `src/lib/whatsapp/providers/uazapi.ts`
- Modify: `src/lib/whatsapp/providers/meta.ts` (lançar `ProviderUnsupportedError`)
- Modify: `src/lib/whatsapp/providers/fake.ts`
- Test: `src/lib/whatsapp/providers/uazapi.test.ts`

**Interfaces:**
- Produces: `listGroups(): Promise<Array<{ groupJid: string; name?: string; avatarUrl?: string }>>` no `WhatsAppProvider`.

- [ ] **Step 1: Descobrir o endpoint real**

⚠️ O endpoint exato **não está confirmado**. Antes de escrever o teste, verificar contra a instância real:

```bash
curl -s -H "token: <token do canal>" https://j7softwarehouse.uazapi.com/group/list | head -c 500
```

Se `404`, tentar `/groups`, `/group/fetchAll`. Registrar no commit qual respondeu e qual o formato. Não seguir com endpoint adivinhado.

- [ ] **Step 2: Escrever o teste que falha**

Em `uazapi.test.ts`, seguindo o padrão dos testes existentes de provider (fetch mockado), assertando que `listGroups` chama o caminho descoberto no Step 1 e mapeia a resposta para `{ groupJid, name, avatarUrl }`.

- [ ] **Step 3: Rodar e confirmar que falha**

Run: `npx vitest run src/lib/whatsapp/providers/uazapi.test.ts`

- [ ] **Step 4: Implementar**

Em `types.ts`, acrescentar ao `WhatsAppProvider`:

```typescript
  /** Grupos de que o número conectado participa. */
  listGroups(): Promise<Array<{ groupJid: string; name?: string; avatarUrl?: string }>>;
```

Em `uazapi.ts`, implementar chamando o endpoint confirmado. Em `meta.ts`, lançar `ProviderUnsupportedError` — a Cloud API não expõe grupos. Em `fake.ts`, devolver lista fixa.

- [ ] **Step 5: Rodar e confirmar que passa**

Run: `npx vitest run src/lib/whatsapp/providers/`

- [ ] **Step 6: Commit**

```bash
git add src/lib/whatsapp/providers/
git commit -m "feat(grupos): provider lista grupos do canal"
```

---

### Task 9: API — listar, sincronizar e habilitar grupos

**Files:**
- Create: `src/app/api/whatsapp/groups/route.ts`
- Create: `src/app/api/whatsapp/groups/sync/route.ts`
- Test: `src/app/api/whatsapp/groups/route.test.ts`

**Interfaces:**
- Consumes: `listGroups` (Tarefa 8), tabela `whatsapp_groups` (Tarefa 1).
- Produces: `GET /api/whatsapp/groups` → `{ groups: Array<{ id, group_jid, name, avatar_url, enabled }> }`; `PATCH /api/whatsapp/groups` com `{ id, enabled }`; `POST /api/whatsapp/groups/sync` → `{ synced: number }`.

- [ ] **Step 1: Escrever o teste que falha**

```typescript
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({ createClient: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }));

import { GET, PATCH } from './route';

/** Cliente com sessão e perfil ligado a `acct-1`. */
function comSessao(grupos: Array<Record<string, unknown>>) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    order: async () => ({ data: grupos, error: null }),
    maybeSingle: async () => ({ data: { account_id: 'acct-1' }, error: null }),
    single: async () => ({ data: grupos[0] ?? null, error: null }),
  };
  return {
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }) },
    from: () => ({ ...chain, update: () => chain }),
  };
}

describe('GET /api/whatsapp/groups', () => {
  beforeEach(() => vi.clearAllMocks());

  it('devolve 401 sem sessao', async () => {
    mocks.createClient.mockResolvedValue({
      auth: { getUser: async () => ({ data: { user: null }, error: null }) },
    });

    const res = await GET(new Request('https://x/api/whatsapp/groups'));

    expect(res.status).toBe(401);
  });

  it('lista os grupos da conta do chamador', async () => {
    mocks.createClient.mockResolvedValue(
      comSessao([{ id: 'g-1', group_jid: '1@g.us', name: 'Turma', enabled: false }]),
    );

    const res = await GET(new Request('https://x/api/whatsapp/groups'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.groups).toHaveLength(1);
    expect(body.groups[0].id).toBe('g-1');
  });
});

describe('PATCH /api/whatsapp/groups', () => {
  it('alterna o enabled do grupo', async () => {
    mocks.createClient.mockResolvedValue(
      comSessao([{ id: 'g-1', enabled: true }]),
    );

    const res = await PATCH(
      new Request('https://x/api/whatsapp/groups', {
        method: 'PATCH',
        body: JSON.stringify({ id: 'g-1', enabled: true }),
      }),
    );

    expect(res.status).toBe(200);
  });

  it('devolve 400 sem id', async () => {
    mocks.createClient.mockResolvedValue(comSessao([]));

    const res = await PATCH(
      new Request('https://x/api/whatsapp/groups', {
        method: 'PATCH',
        body: JSON.stringify({ enabled: true }),
      }),
    );

    expect(res.status).toBe(400);
  });
});
```

> **Tenancy:** o teste acima cobre o caminho feliz e a validação. A garantia de que um grupo de outra conta não é alcançável vem do `.eq('account_id', accountId)` em toda query somado à policy RLS da Tarefa 1 — verificar isso manualmente em homologação (Tarefa 12), já que o fake não reproduz RLS.

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run src/app/api/whatsapp/groups/route.test.ts`

- [ ] **Step 3: Implementar**

`route.ts` resolve `account_id` pelo perfil do usuário autenticado (mesmo padrão de `/api/whatsapp/send`), e toda query é escopada por `account_id`. `sync/route.ts` chama `getProviderForChannel(...).listGroups()` e faz upsert em `whatsapp_groups` por `(account_id, channel_id, group_jid)`, **preservando `enabled`** dos grupos já existentes — sincronizar não pode desligar o que o usuário ligou.

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run src/app/api/whatsapp/groups/`

- [ ] **Step 5: Commit**

```bash
git add src/app/api/whatsapp/groups/
git commit -m "feat(grupos): API para listar, sincronizar e habilitar grupos"
```

---

### Task 10: UI — aba de seleção de grupos

**Files:**
- Create: `src/components/settings/groups-manager.tsx`
- Modify: `src/components/settings/settings-overview.tsx`
- Modify: `messages/pt.json`, `messages/en.json`, `messages/ko.json`

**Interfaces:**
- Consumes: API da Tarefa 9.

- [ ] **Step 1: Acrescentar os textos**

Em `messages/pt.json`, sob `Settings`:

```json
"groups": {
  "title": "Grupos",
  "description": "Escolha quais grupos de WhatsApp aparecem na caixa de entrada.",
  "sync": "Sincronizar grupos",
  "empty": "Nenhum grupo encontrado. Sincronize ou aguarde alguém escrever em um grupo.",
  "enabled": "Na caixa de entrada",
  "readOnly": "Somente leitura por enquanto — o envio em grupo chega numa próxima etapa."
}
```

Traduzir o equivalente em `en.json` e `ko.json`.

- [ ] **Step 2: Implementar o componente**

`groups-manager.tsx`: lista os grupos, botão "Sincronizar", um `Switch` por grupo que chama o `PATCH`. Seguir o padrão visual de `channels-manager.tsx`. Estado vazio usa o texto `empty`. Exibir o aviso `readOnly` no topo.

- [ ] **Step 3: Registrar a aba**

Em `settings-overview.tsx`, acrescentar a entrada "Grupos" junto de Canais, respeitando o controle de acesso já existente no arquivo.

- [ ] **Step 4: Verificar no navegador**

Rodar `npm run dev`, abrir Configurações → Grupos, sincronizar e alternar um grupo. Confirmar que o `enabled` persiste após recarregar.

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/ messages/
git commit -m "feat(grupos): aba de selecao de grupos nas configuracoes"
```

---

### Task 11: UI — thread de grupo com autor por mensagem

**Files:**
- Modify: `src/components/inbox/message-bubble.tsx`
- Modify: `src/components/inbox/message-thread.tsx`
- Modify: `messages/pt.json`, `messages/en.json`, `messages/ko.json`
- Test: `src/components/inbox/message-author.test.ts`

**Interfaces:**
- Consumes: `messages.participant_id` (Tarefa 1), conversas de grupo (Tarefa 7).

- [ ] **Step 1: Escrever o teste que falha**

Em `message-author.test.ts`, acrescentar:

```typescript
it('mostra autor em mensagem de participante de grupo', () => {
  // Em grupo cada mensagem recebida vem de uma pessoa diferente —
  // sem autor a thread vira uma pilha de baloes anonimos.
  expect(
    shouldShowAuthor({ sender_type: 'customer', sender_id: null, participant_id: 'p-1' }),
  ).toBe(true);
});

it('segue sem autor em mensagem 1:1 do contato', () => {
  expect(
    shouldShowAuthor({ sender_type: 'customer', sender_id: null }),
  ).toBe(false);
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run src/components/inbox/message-author.test.ts`
Esperado: FAIL — hoje `customer` sempre devolve `false`.

- [ ] **Step 3: Implementar**

Em `message-author.ts`, estender o tipo e a regra:

```typescript
export interface AuthorableMessage {
  sender_type: 'agent' | 'customer';
  sender_id: string | null;
  /** Presente só em mensagem recebida de grupo. */
  participant_id?: string | null;
}

export function shouldShowAuthor(current: AuthorableMessage): boolean {
  // Em grupo, identificar quem falou é o ponto: cada mensagem vem de
  // uma pessoa diferente. No 1:1 o cabeçalho da conversa já resolve.
  if (current.participant_id) return true;
  return current.sender_type === 'agent';
}
```

- [ ] **Step 4: Resolver o nome do participante**

Em `message-thread.tsx`, carregar `group_participants` da conversa (quando `group_id` presente) e montar um mapa `participant_id → display_name`, no mesmo padrão do mapa `authorNames` que já existe para operadores. Fallback: `display_name` → `phone` → o texto `Inbox.bubble.participant`.

Acrescentar em `messages/pt.json`, sob `Inbox.bubble`: `"participant": "Participante"`. Traduzir nos outros dois arquivos.

- [ ] **Step 5: Desabilitar o composer em grupo**

Em `message-thread.tsx`, quando a conversa tiver `group_id`, renderizar o composer desabilitado com o texto `Settings.groups.readOnly`. Fase 1 não envia; caminho explicitamente fechado é melhor que botão que falha.

- [ ] **Step 6: Rodar os testes**

Run: `npx vitest run src/components/inbox/`

- [ ] **Step 7: Commit**

```bash
git add src/components/inbox/ messages/
git commit -m "feat(grupos): thread de grupo identifica o participante autor"
```

---

### Task 12: Verificação ponta a ponta em homologação

**Files:** nenhum (validação).

- [ ] **Step 1: Publicar em homologação**

```bash
git push origin <branch>:staging
```

Aguardar o build e **reapontar o alias** — ele não atualiza sozinho:

```bash
npx vercel ls
npx vercel alias set <deployment-novo> wacrm-git-staging-ramonppaula-5619s-projects.vercel.app
npx vercel inspect wacrm-git-staging-ramonppaula-5619s-projects.vercel.app
```

Confirmar que a data do deployment é a de agora.

- [ ] **Step 2: Verificar os critérios de aceite**

1. Mandar mensagem num grupo **não** habilitado → não aparece na inbox, mas o grupo passa a ser listado em Configurações → Grupos.
2. Habilitar o grupo e mandar outra → aparece na inbox com o autor identificado em cada balão.
3. Conferir no banco que **nenhum** participante entrou em `contacts`:

```sql
SELECT COUNT(*) FROM contacts WHERE phone IN (
  SELECT phone FROM group_participants WHERE phone IS NOT NULL
);
```
Esperado: `0`.

4. Com uma automação ativa de `new_message_received`, mandar mensagem no grupo e confirmar que **nada** foi disparado (nem resposta no grupo, nem execução registrada).
5. Mandar e receber mensagem 1:1 → comportamento idêntico ao de antes.

- [ ] **Step 3: Aplicar a migration em produção**

Só depois de todos os critérios passarem em homologação. Rodar o SQL da Tarefa 1 no projeto `jynplnaslifzftyhasna` e conferir a constraint, como no Step 2 da Tarefa 1.

- [ ] **Step 4: Abrir o PR para produção**

```bash
gh pr create --repo j7softwarehouse/wacrm --base production --head staging \
  --title "Grupos de WhatsApp — Fase 1 (leitura)"
```

O corpo deve registrar que a migration já foi aplicada à mão nos dois ambientes e que envio em grupo continua fora de escopo.

---

## Notas de execução

- **A Tarefa 3 não pode ser pulada nem adiada.** É a única proteção contra o bot responder dentro de grupos, e o erro é irreversível — a mensagem já chegou a terceiros.
- **O endpoint de listar grupos (Tarefa 8) é uma incógnita real.** Confirmar contra a API antes de escrever código; não adivinhar.
- **Migrations são manuais nos dois ambientes.** Homologação primeiro, produção só depois dos critérios de aceite.
- **O alias de homologação não atualiza sozinho.** Todo deploy exige `vercel alias set`, senão você testa um build antigo — isso já custou horas de depuração numa entrega anterior.

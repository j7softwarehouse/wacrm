# Adaptação Escolar Fase 1 — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adaptar o wacrm à operação diária de uma escola — autoria de mensagem, distinção de contato novo, importação em XLSX, mídia acessível, alerta de resposta e ocultação do módulo de vendas — sem bifurcar o código entre clientes.

**Architecture:** Tudo que é específico de escola nasce como configuração por conta (`accounts.disabled_modules`), não como código condicional por cliente. Regras de horário usam fuso explícito, nunca o do ambiente. Cada mudança de schema é uma migração idempotente aplicada pela Supabase CLI.

**Tech Stack:** Next.js 16.2.12, TypeScript, Supabase (Postgres + RLS), Vitest, Tailwind, next-intl.

**Spec:** `docs/superpowers/specs/2026-07-31-adaptacao-escolar-design.md`

## Global Constraints

- Trabalho acontece na branch `staging`. Nada é commitado direto em `production` — a promoção é `staging → production` após validação, conforme regra definida em 2026-07-31.
- Migrations seguem o formato da Supabase CLI: `<timestamp de 14 dígitos>_nome.sql`, idempotentes (`IF NOT EXISTS` / `DROP ... IF EXISTS`).
- `supabase db push` é aplicado primeiro no projeto de homologação-e-dev (`mpwjlshxfxfvysoeyyzy`), nunca direto em produção.
- Nenhum comando destrutivo roda contra homologação ou produção.
- Cálculo de horário usa `America/Sao_Paulo` explicitamente. **Nunca** usar `setHours`/`getDay` sem fuso — `src/lib/dashboard/date-utils.ts` já tem esse defeito e seus testes falham por causa dele.
- `disabled_modules` é opt-out: default `{}` mantém todo o comportamento atual para contas existentes.
- Os 5 testes que já falham em `src/lib/currency.test.ts` e `src/lib/dashboard/date-utils.test.ts` são pré-existentes e alheios a este plano. Não corrigi-los aqui; apenas não aumentar o número.
- Nomes de coluna em inglês, comentários e textos de interface em português — padrão vigente no repositório.

## Ações que exigem o usuário

| Ação | Task |
|---|---|
| Aprovar a biblioteca de XLSX antes de instalar | 6 |
| Fornecer a lista de contatos em XLSX ou CSV | 6 |
| Executar a importação pela tela | 6 |
| Definir `disabled_modules = {'sales'}` na conta da escola | 10 |

---

### Task 1: Gravar o autor da mensagem enviada

`messages.sender_id` existe desde a migração 001 mas nunca foi preenchido: verificado em produção, **toda** mensagem de agente tem `sender_id = null`. Esta é a primeira task porque é a única cujo custo cresce com o tempo — cada dia de uso acumula histórico sem autoria, irrecuperável.

**Files:**
- Modify: `src/lib/whatsapp/send-message.ts` (interface `SendMessageParams` ~linha 68; insert ~linha 420)
- Modify: `src/app/api/whatsapp/send/route.ts` (chamada ~linha 176)
- Test: `src/lib/whatsapp/send-message.test.ts`

**Interfaces:**
- Produces: `SendMessageParams.senderUserId?: string | null` — a Task 2 consome `messages.sender_id` já preenchido.

- [ ] **Step 1: Escrever o teste que falha**

Acrescentar ao final de `src/lib/whatsapp/send-message.test.ts`:

```typescript
describe('sendMessageToConversation — autoria', () => {
  it('aceita senderUserId no contrato de parâmetros', () => {
    // Regressão: `sender_id` existia no banco desde a 001 mas nenhum
    // caminho de envio o preenchia, então todo histórico enviado ficou
    // sem autor. O contrato precisa carregar o autor até o insert.
    const params: SendMessageParams = {
      conversationId: 'cv-1',
      messageType: 'text',
      contentText: 'oi',
      senderUserId: 'user-1',
    };
    expect(params.senderUserId).toBe('user-1');
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run src/lib/whatsapp/send-message.test.ts`
Expected: FAIL — TypeScript acusa que `senderUserId` não existe em `SendMessageParams`.

- [ ] **Step 3: Adicionar o campo ao contrato**

Em `src/lib/whatsapp/send-message.ts`, dentro de `SendMessageParams`:

```typescript
  replyToMessageId?: string | null;
  /**
   * Usuário que disparou o envio, quando há humano por trás. Nulo em
   * automação, fluxo, broadcast e API pública — nesses casos a origem
   * é o sistema, não uma pessoa. Resposta automática de IA continua
   * distinguida por `ai_generated`.
   */
  senderUserId?: string | null;
```

- [ ] **Step 4: Preencher no insert**

Em `src/lib/whatsapp/send-message.ts`, no insert de `messages` (~linha 420), acrescentar a linha após `sender_type`:

```typescript
      sender_type: 'agent',
      sender_id: params.senderUserId ?? null,
```

- [ ] **Step 5: Passar o usuário na rota do painel**

Em `src/app/api/whatsapp/send/route.ts`, na chamada a `sendMessageToConversation` (~linha 176), acrescentar ao objeto de parâmetros:

```typescript
        senderUserId: user.id,
```

`user` já existe no escopo — é usado no rate limit da linha 42.

- [ ] **Step 6: Rodar os testes**

Run: `npx vitest run src/lib/whatsapp/send-message.test.ts`
Expected: PASS

- [ ] **Step 7: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 8: Commit**

```bash
git add src/lib/whatsapp/send-message.ts src/app/api/whatsapp/send/route.ts src/lib/whatsapp/send-message.test.ts
git commit -m "feat(inbox): grava o autor da mensagem enviada

messages.sender_id existia desde a migracao 001 mas nenhum caminho de
envio o preenchia -- todo o historico enviado ficou sem autor. O
painel agora repassa o usuario autenticado; automacao, broadcast e API
publica seguem com autor nulo por nao terem humano por tras."
```

---

### Task 2: Exibir o autor e marcar a troca de operador

Com mais de um operador na mesma conversa, hoje não há como saber onde termina o atendimento de um e começa o do outro — dor relatada pelo cliente.

**Files:**
- Modify: `src/components/inbox/message-thread.tsx` (carregar nomes dos autores)
- Modify: `src/components/inbox/message-bubble.tsx` (exibir)
- Test: `src/components/inbox/message-author.test.ts` (criar)

**Interfaces:**
- Consumes: `messages.sender_id` preenchido pela Task 1.
- Produces: `shouldShowAuthor(mensagemAtual, mensagemAnterior): boolean` — regra pura de agrupamento.

- [ ] **Step 1: Escrever o teste da regra de agrupamento**

Criar `src/components/inbox/message-author.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';

import { shouldShowAuthor } from './message-author';

const base = { sender_type: 'agent' as const, sender_id: 'u1' };

describe('shouldShowAuthor', () => {
  it('mostra o autor na primeira mensagem da conversa', () => {
    expect(shouldShowAuthor(base, null)).toBe(true);
  });

  it('esconde quando o mesmo operador manda em sequencia', () => {
    expect(shouldShowAuthor(base, { ...base })).toBe(false);
  });

  it('mostra quando o operador muda', () => {
    expect(shouldShowAuthor(base, { ...base, sender_id: 'u2' })).toBe(true);
  });

  it('mostra quando a anterior era do contato', () => {
    // A resposta depois de uma fala do cliente sempre reabre o bloco.
    expect(
      shouldShowAuthor(base, { sender_type: 'customer', sender_id: null }),
    ).toBe(true);
  });

  it('nunca mostra autor em mensagem do contato', () => {
    expect(
      shouldShowAuthor({ sender_type: 'customer', sender_id: null }, null),
    ).toBe(false);
  });

  it('trata sistema e humano como autores distintos', () => {
    // Automacao seguida de resposta humana precisa quebrar o bloco.
    expect(shouldShowAuthor(base, { ...base, sender_id: null })).toBe(true);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run src/components/inbox/message-author.test.ts`
Expected: FAIL — `Cannot find module './message-author'`.

- [ ] **Step 3: Implementar a regra**

Criar `src/components/inbox/message-author.ts`:

```typescript
/**
 * Decide se o balão deve estampar o nome de quem enviou.
 *
 * Repetir o autor em toda mensagem polui a leitura; o que resolve a dor
 * real ("onde termina o atendimento de um operador e começa o do
 * outro") é marcar a TROCA. Por isso o nome só aparece quando o autor
 * muda em relação à mensagem imediatamente anterior.
 */
export interface AuthorableMessage {
  sender_type: 'agent' | 'customer';
  sender_id: string | null;
}

export function shouldShowAuthor(
  current: AuthorableMessage,
  previous: AuthorableMessage | null,
): boolean {
  // Mensagem do contato nunca leva autor: quem falou é o próprio
  // contato, já identificado pelo cabeçalho da conversa.
  if (current.sender_type !== 'agent') return false;
  if (!previous) return true;
  if (previous.sender_type !== 'agent') return true;
  return previous.sender_id !== current.sender_id;
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run src/components/inbox/message-author.test.ts`
Expected: PASS (6 testes)

- [ ] **Step 5: Carregar os nomes dos autores no thread**

Em `src/components/inbox/message-thread.tsx`, após carregar as mensagens, buscar os perfis dos `sender_id` distintos e montar um mapa `id → nome`:

```typescript
// Nomes dos autores para estampar no balão. A política
// `profiles_select` (migração 017) já permite a qualquer membro ler o
// perfil dos colegas da mesma conta, então uma consulta direta basta.
const authorIds = [
  ...new Set(
    messages
      .filter((m) => m.sender_type === 'agent' && m.sender_id)
      .map((m) => m.sender_id as string),
  ),
];

const authorNames: Record<string, string> = {};
if (authorIds.length > 0) {
  const { data: profiles } = await supabase
    .from('profiles')
    .select('user_id, full_name, email')
    .in('user_id', authorIds);
  for (const p of profiles ?? []) {
    authorNames[p.user_id] = p.full_name || p.email || '';
  }
}
```

Repassar `authorNames` e a mensagem anterior para cada `MessageBubble`.

- [ ] **Step 6: Estampar no balão**

Em `src/components/inbox/message-bubble.tsx`, antes do conteúdo da mensagem enviada, renderizar o autor quando `shouldShowAuthor` for verdadeiro:

```tsx
{showAuthor && (
  <span className="mb-0.5 block text-[11px] font-medium opacity-70">
    {authorName || t('systemSender')}
  </span>
)}
```

- [ ] **Step 7: Acrescentar a tradução**

Em `messages/pt.json`, dentro do namespace do Inbox:

```json
"systemSender": "Sistema"
```

E o equivalente em `messages/en.json` (`"System"`) e `messages/ko.json` (`"시스템"`).

- [ ] **Step 8: Verificar build e testes**

Run: `npx tsc --noEmit && npx vitest run src/components/inbox/`
Expected: sem erro de tipo; testes do inbox passam.

- [ ] **Step 9: Commit**

```bash
git add src/components/inbox/ messages/
git commit -m "feat(inbox): estampa o autor e marca a troca de operador

O nome so aparece quando o autor muda -- repetir em todo balao poluiria
a leitura, e o que resolve a dor relatada e enxergar onde termina o
atendimento de um e comeca o do outro. Mensagem sem autor identificado
(automacao, broadcast, API) aparece como Sistema."
```

---

### Task 3: Migração — `contacts.source` e `accounts.disabled_modules`

As duas colunas viajam na mesma migração porque ambas são aditivas, com default seguro, e aplicá-las juntas reduz a superfície de operações contra o banco.

**Files:**
- Create: `supabase/migrations/20260731000001_school_adaptation.sql`

**Interfaces:**
- Produces: `contacts.source TEXT DEFAULT 'whatsapp'`, `accounts.disabled_modules TEXT[] DEFAULT '{}'` — consumidos pelas Tasks 4, 5, 9 e 10.

- [ ] **Step 1: Escrever a migração**

Criar `supabase/migrations/20260731000001_school_adaptation.sql`:

```sql
-- ============================================================
-- 20260731000001_school_adaptation
--
-- Duas colunas aditivas para a adaptação escolar:
--
--   contacts.source          — de onde veio o contato, para distinguir
--                              "família da lista" de "alguém novo que
--                              acabou de escrever". A escola opera dois
--                              números e a secretaria precisa saber, no
--                              meio do atendimento, com quem está falando.
--
--   accounts.disabled_modules — módulos desligados por conta. Opt-out:
--                              o default vazio mantém todo o
--                              comportamento atual, então nenhuma conta
--                              existente muda. Espelha o padrão de
--                              profiles.beta_features (migração 011).
--
-- Idempotente — seguro re-executar.
-- ============================================================

-- ─── contacts.source ────────────────────────────────────────
-- Default 'whatsapp' porque é o que as linhas existentes de fato são:
-- criadas pelo webhook a partir de mensagem recebida.
ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'whatsapp';

ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_source_check;
ALTER TABLE contacts
  ADD CONSTRAINT contacts_source_check
  CHECK (source IN ('whatsapp', 'import', 'manual'));

-- A lista de "não identificados" é a varredura diária da secretaria;
-- o índice parcial serve exatamente essa consulta sem custo nas demais.
CREATE INDEX IF NOT EXISTS idx_contacts_source_new
  ON contacts (account_id)
  WHERE source = 'whatsapp';

COMMENT ON COLUMN contacts.source IS
  'Procedência do contato: whatsapp (criado por mensagem recebida, '
  'ainda não identificado), import (veio da lista da organização) ou '
  'manual (cadastrado à mão). Não é etiqueta editável.';

-- ─── accounts.disabled_modules ──────────────────────────────
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS disabled_modules TEXT[]
    NOT NULL
    DEFAULT ARRAY[]::TEXT[];

COMMENT ON COLUMN accounts.disabled_modules IS
  'Módulos desligados nesta conta (ex.: {sales}). Opt-out: vazio '
  'significa tudo ligado, preservando o comportamento padrão.';
```

- [ ] **Step 2: Aplicar em homologação**

```bash
export SUPABASE_ACCESS_TOKEN=<token>
npx supabase link --project-ref mpwjlshxfxfvysoeyyzy
npx supabase db push
```

Expected: a migração aplica sem erro.

- [ ] **Step 3: Conferir o resultado**

No SQL Editor do projeto de homologação:

```sql
SELECT source, count(*) FROM contacts GROUP BY source;
SELECT name, disabled_modules FROM accounts;
```

Expected: todos os contatos com `source = 'whatsapp'`; `disabled_modules` vazio em toda conta.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260731000001_school_adaptation.sql
git commit -m "feat(db): contacts.source e accounts.disabled_modules

Ambas aditivas e com default seguro: contatos existentes viram
'whatsapp' (o que de fato sao) e disabled_modules vazio preserva o
comportamento atual de toda conta."
```

---

### Task 4: Preencher `source` nos três caminhos de criação

Sem isto a coluna existe mas mente: todo contato continuaria nascendo com o default `whatsapp`, inclusive os importados.

**Files:**
- Modify: `src/lib/whatsapp/inbound/ingest.ts` (criação pelo webhook)
- Modify: `src/components/contacts/import-modal.tsx` (importação)
- Modify: `src/components/contacts/contact-form.tsx` (criação e edição manual)
- Modify: `src/lib/api/v1/contacts.ts` (criação pela API pública — também é manual)
- Test: `src/lib/contacts/source.test.ts` (criar)

**Interfaces:**
- Consumes: coluna `contacts.source` da Task 3.
- Produces: contatos com `source` correto — a Task 5 exibe o badge com base nisso.

- [ ] **Step 1: Escrever o teste da constante**

Criar `src/lib/contacts/source.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';

import { CONTACT_SOURCE, isUnidentified } from './source';

describe('CONTACT_SOURCE', () => {
  it('cobre os tres caminhos de criacao', () => {
    expect(CONTACT_SOURCE.WHATSAPP).toBe('whatsapp');
    expect(CONTACT_SOURCE.IMPORT).toBe('import');
    expect(CONTACT_SOURCE.MANUAL).toBe('manual');
  });
});

describe('isUnidentified', () => {
  it('so o contato criado por mensagem recebida e nao identificado', () => {
    expect(isUnidentified('whatsapp')).toBe(true);
    expect(isUnidentified('import')).toBe(false);
    expect(isUnidentified('manual')).toBe(false);
  });

  it('trata ausencia de origem como nao identificado', () => {
    // Linha anterior a migracao, ou schema mais novo que o codigo.
    expect(isUnidentified(null)).toBe(true);
    expect(isUnidentified(undefined)).toBe(true);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run src/lib/contacts/source.test.ts`
Expected: FAIL — `Cannot find module './source'`.

- [ ] **Step 3: Implementar**

Criar `src/lib/contacts/source.ts`:

```typescript
/**
 * Procedência do contato. Existe como coluna, e não como tag, porque
 * tag é editável e some sem rastro no meio das tags de uso cotidiano
 * (turma, assunto) — enquanto a origem é um fato sobre como o contato
 * entrou no sistema.
 */
export const CONTACT_SOURCE = {
  /** Criado pelo webhook a partir de mensagem recebida. */
  WHATSAPP: 'whatsapp',
  /** Veio da lista importada da organização. */
  IMPORT: 'import',
  /** Cadastrado à mão na tela. */
  MANUAL: 'manual',
} as const;

export type ContactSource =
  (typeof CONTACT_SOURCE)[keyof typeof CONTACT_SOURCE];

/**
 * Contato que ninguém identificou ainda — só o nome de perfil que o
 * WhatsApp entregou. É o que a secretaria precisa enxergar de relance.
 * Origem ausente é tratada como não identificada: linha anterior à
 * migração é exatamente esse caso.
 */
export function isUnidentified(source: string | null | undefined): boolean {
  return source !== CONTACT_SOURCE.IMPORT && source !== CONTACT_SOURCE.MANUAL;
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run src/lib/contacts/source.test.ts`
Expected: PASS (3 testes)

- [ ] **Step 5: Marcar a criação pelo webhook**

Em `src/lib/whatsapp/inbound/ingest.ts`, no insert de `contacts`, acrescentar:

```typescript
      source: CONTACT_SOURCE.WHATSAPP,
```

- [ ] **Step 6: Marcar a importação**

Em `src/components/contacts/import-modal.tsx`, no insert das linhas importadas, acrescentar a cada registro:

```typescript
      source: CONTACT_SOURCE.IMPORT,
```

- [ ] **Step 7: Marcar a criação manual**

Em `src/components/contacts/contact-form.tsx`, no insert de contato novo, e em
`src/lib/api/v1/contacts.ts`, no insert da API pública:

```typescript
      source: CONTACT_SOURCE.MANUAL,
```

Contato cadastrado à mão ou por integração já nasce identificado — alguém sabia
quem era ao criá-lo.

- [ ] **Step 8: Promover ao identificar**

Em `src/components/contacts/contact-form.tsx`, no caminho de edição: quando o
contato tem `source === CONTACT_SOURCE.WHATSAPP` e o nome está sendo alterado,
gravar também `source: CONTACT_SOURCE.MANUAL`.

```typescript
// Nomear um contato que chegou por mensagem é o ato de identificá-lo:
// deixa de ser "alguém novo" e passa a ser gente conhecida da casa.
const patch: Record<string, unknown> = { name, email, company };
if (contact.source === CONTACT_SOURCE.WHATSAPP && name !== contact.name) {
  patch.source = CONTACT_SOURCE.MANUAL;
}
```

- [ ] **Step 9: Rodar a suíte e verificar tipos**

Run: `npx tsc --noEmit && npx vitest run src/lib/contacts/`
Expected: sem erro de tipo; testes de contatos passam.

- [ ] **Step 10: Commit**

```bash
git add src/lib/contacts/source.ts src/lib/contacts/source.test.ts src/lib/whatsapp/inbound/ingest.ts src/components/contacts/import-modal.tsx src/app/\(dashboard\)/contacts/
git commit -m "feat(contacts): marca a procedencia de cada contato

Webhook grava whatsapp, importacao grava import, cadastro manual grava
manual. Contato criado por mensagem que depois recebe nome passa a
manual -- deixou de ser desconhecido."
```

---

### Task 5: Badge "Novo" na lista e no inbox

**Files:**
- Modify: `src/app/(dashboard)/contacts/page.tsx` (coluna + filtro)
- Modify: o painel de contato do inbox
- Modify: `messages/pt.json`, `messages/en.json`, `messages/ko.json`

**Interfaces:**
- Consumes: `isUnidentified(source)` da Task 4.

- [ ] **Step 1: Acrescentar as traduções**

Em `messages/pt.json`, no namespace `Contacts`:

```json
"newBadge": "Novo",
"newBadgeTooltip": "Contato ainda não identificado — chegou por mensagem recebida",
"filterUnidentified": "Somente não identificados"
```

Em `messages/en.json`: `"New"`, `"Unidentified contact — arrived via inbound message"`, `"Unidentified only"`.
Em `messages/ko.json`: `"신규"`, `"미확인 연락처 — 수신 메시지로 유입"`, `"미확인만"`.

- [ ] **Step 2: Exibir o badge na lista de Contatos**

Na tabela de contatos, ao lado do nome:

```tsx
{isUnidentified(contact.source) && (
  <span
    title={t('newBadgeTooltip')}
    className="ml-2 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-amber-600 dark:text-amber-400"
  >
    {t('newBadge')}
  </span>
)}
```

- [ ] **Step 3: Acrescentar o filtro**

Ao lado do filtro de tags já existente, um botão de alternância que restringe a listagem a `source = 'whatsapp'`.

- [ ] **Step 4: Exibir o badge no painel do inbox**

No painel de contato do inbox — onde já aparecem TAGS, NEGÓCIOS e NOTAS — mostrar o mesmo badge junto ao nome. É onde a secretária mais precisa ver, durante o atendimento.

- [ ] **Step 5: Verificar visualmente**

```bash
npx next dev -p 3005
```

Abrir `/contacts` em homologação e conferir: contatos importados sem badge, contatos vindos de mensagem com badge "Novo". Abrir uma conversa e conferir o badge no painel lateral.

- [ ] **Step 6: Commit**

```bash
git add src/app/\(dashboard\)/contacts/ src/components/inbox/ messages/
git commit -m "feat(contacts): badge de contato nao identificado

Aparece na lista (com filtro) e no painel do inbox. Dos 19 contatos
hoje em producao, 18 nao constam da lista da escola -- a distincao nao
e hipotetica."
```

---

### Task 6: Importação em XLSX e correção do CSV

O parser atual faz `.split(',')` sem tratar codificação. O Excel em português salva CSV com `;` e em Latin-1: o arquivo vira uma coluna só, o cabeçalho `phone` não é encontrado e a importação falha inteira, quando não corrompe os acentos. Não é erro de uso — é incompatibilidade.

**Files:**
- Modify: `src/lib/contacts/parse-contact-csv.ts`
- Create: `src/lib/contacts/parse-contact-sheet.ts`
- Modify: `src/components/contacts/import-modal.tsx`
- Test: `src/lib/contacts/parse-contact-csv.test.ts`

**Interfaces:**
- Produces: `parseContactSheet(file: File): Promise<ParsedContactRow[]>` — aceita `.xlsx` e `.csv`.

> **AÇÃO DO USUÁRIO:** aprovar a biblioteca antes da instalação. O pacote `xlsx` do npm está desatualizado e com vulnerabilidades conhecidas; a versão mantida do SheetJS saiu do npm. O implementador deve levantar as alternativas ativas, apresentar a escolha com a justificativa e só então instalar. O sistema trata dado de menores e não deve ganhar dependência com CVE conhecido.

- [ ] **Step 1: Escrever os testes do parser de CSV**

Acrescentar a `src/lib/contacts/parse-contact-csv.test.ts`:

```typescript
describe('parseContactCsv — compatibilidade com Excel pt-BR', () => {
  it('aceita ponto e virgula como separador', () => {
    // Excel em portugues salva CSV com ';'. Com split(',') o arquivo
    // virava uma coluna so e a importacao falhava inteira.
    const csv = 'phone;name\n553191234567;Angélica Nunes';
    const { rows } = parseContactCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].phone).toBe('553191234567');
    expect(rows[0].name).toBe('Angélica Nunes');
  });

  it('continua aceitando virgula', () => {
    const csv = 'phone,name\n553191234567,Angélica Nunes';
    const { rows } = parseContactCsv(csv);
    expect(rows[0].name).toBe('Angélica Nunes');
  });

  it('descarta o BOM que o Excel escreve no inicio do arquivo', () => {
    const csv = '﻿phone;name\n553191234567;Bárbara';
    const { rows } = parseContactCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Bárbara');
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run src/lib/contacts/parse-contact-csv.test.ts`
Expected: FAIL nos casos de `;` e BOM.

- [ ] **Step 3: Detectar separador e BOM**

Em `src/lib/contacts/parse-contact-csv.ts`, antes de separar o cabeçalho:

```typescript
  // O Excel em português salva CSV com ';' e prefixa BOM. Sem tratar os
  // dois, o arquivo vira uma coluna só e os acentos se perdem — a
  // importação falhava inteira e parecia erro do usuário.
  const clean = text.replace(/^﻿/, '');
  const lines = clean.trim().split(/\r?\n/);
  if (lines.length === 0) {
    return { rows: [], hasTagsColumn: false, hasCompanyColumn: false };
  }

  // Vence o separador que produz mais colunas no cabeçalho.
  const delimiter =
    lines[0].split(';').length > lines[0].split(',').length ? ';' : ',';
```

Substituir os `.split(',')` subsequentes por `.split(delimiter)`.

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run src/lib/contacts/parse-contact-csv.test.ts`
Expected: PASS

- [ ] **Step 5: Apresentar a escolha da biblioteca de XLSX**

Levantar as alternativas mantidas, comparar tamanho e histórico de segurança, e apresentar a recomendação ao usuário. **Não instalar antes da aprovação.**

- [ ] **Step 6: Implementar a leitura de planilha**

Criar `src/lib/contacts/parse-contact-sheet.ts`, que detecta o tipo pelo nome do arquivo, lê `.xlsx` pela biblioteca aprovada e delega `.csv` ao parser existente, devolvendo o mesmo `ParsedContactRow[]` nos dois casos.

- [ ] **Step 7: Aceitar o novo formato na tela**

Em `src/components/contacts/import-modal.tsx`, trocar o `accept` do input:

```tsx
accept=".csv,text/csv,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
```

E trocar a chamada de `parseContactCsv(text)` por `parseContactSheet(file)`.

- [ ] **Step 8: Testar com arquivo real**

Salvar uma planilha de teste no Excel em português, com acento no nome, tanto em `.xlsx` quanto em `.csv`, e importar as duas em homologação.
Expected: as duas importam; acentos preservados.

- [ ] **Step 9: Commit**

```bash
git add src/lib/contacts/ src/components/contacts/import-modal.tsx package.json package-lock.json
git commit -m "feat(contacts): importacao em XLSX e CSV compativel com Excel pt-BR

O parser fazia split(',') sem tratar codificacao: arquivo salvo pelo
Excel em portugues (separador ';', com BOM) virava uma coluna so e a
importacao falhava inteira, alem de corromper acentos. Agora detecta o
separador, descarta o BOM e aceita .xlsx direto."
```

---

### Task 7: Abrir e baixar a mídia recebida

A imagem aparece mas não há como abrir nem baixar: o componente renderiza um `<img>` sem clique, sem link e sem download, e usa `object-cover`, que corta. A foto de teste (768×1376) aparece truncada num quadro de 240×256.

**Files:**
- Modify: `src/components/inbox/message-bubble.tsx` (`MediaImage`, ~linhas 59-120)
- Modify: `messages/pt.json`, `messages/en.json`, `messages/ko.json`

- [ ] **Step 1: Acrescentar as traduções**

Em `messages/pt.json`, no namespace do Inbox:

```json
"openMedia": "Abrir em tamanho real",
"downloadMedia": "Baixar",
"closeMedia": "Fechar"
```

Em `messages/en.json`: `"Open full size"`, `"Download"`, `"Close"`.
Em `messages/ko.json`: `"원본 크기로 보기"`, `"다운로드"`, `"닫기"`.

- [ ] **Step 2: Parar de cortar a miniatura**

Em `MediaImage`, trocar `object-cover` por `object-contain` e tornar a imagem clicável:

```tsx
    <button
      type="button"
      onClick={() => setExpanded(true)}
      className="block cursor-zoom-in"
      aria-label={t('openMedia')}
    >
      <img
        src={src ?? ''}
        alt={alt}
        className="max-h-64 max-w-60 rounded-lg object-contain"
        onError={() => setError(true)}
      />
    </button>
```

- [ ] **Step 3: Abrir em tamanho real**

Renderizar a sobreposição quando `expanded`, com a imagem inteira e um botão de download:

```tsx
{expanded && (
  <div
    className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
    onClick={() => setExpanded(false)}
    role="dialog"
    aria-modal="true"
  >
    <img
      src={src ?? ''}
      alt={alt}
      className="max-h-full max-w-full object-contain"
      onClick={(e) => e.stopPropagation()}
    />
    <a
      href={src ?? ''}
      download
      onClick={(e) => e.stopPropagation()}
      className="absolute right-4 top-4 rounded-lg bg-white/90 px-3 py-1.5 text-sm font-medium text-black"
    >
      {t('downloadMedia')}
    </a>
  </div>
)}
```

- [ ] **Step 4: Fechar com Escape**

Acrescentar o listener de teclado enquanto a sobreposição estiver aberta, removendo-o na limpeza do efeito.

- [ ] **Step 5: Aplicar o mesmo a vídeo**

O bloco de vídeo (~linha 150) ganha o mesmo botão de download. Documento já é link de download hoje e não muda.

- [ ] **Step 6: Verificar visualmente**

```bash
npx next dev -p 3005
```

Em homologação, abrir a conversa com a imagem de teste: a miniatura mostra a foto inteira (sem corte), o clique abre em tamanho real, o download salva o arquivo, e Escape fecha.

- [ ] **Step 7: Commit**

```bash
git add src/components/inbox/message-bubble.tsx messages/
git commit -m "feat(inbox): abre e baixa a midia recebida

A imagem aparecia mas nao havia como abrir nem baixar -- o componente
era um <img> sem clique e sem link -- e object-cover cortava a foto.
Agora a miniatura preserva a proporcao, o clique abre em tamanho real e
ha download explicito."
```

---

### Task 8: `businessMinutesBetween` — minutos de expediente

Coração da regra do alerta. Nasce isolado e testado antes de ser usado em qualquer lugar, porque é onde mora toda a sutileza: virada de dia, fim de semana e fuso.

**Files:**
- Create: `src/lib/dashboard/business-hours.ts`
- Test: `src/lib/dashboard/business-hours.test.ts`

**Interfaces:**
- Produces: `businessMinutesBetween(from: Date, to: Date): number` e `isWithinBusinessHours(at: Date): boolean` — consumidos pela Task 9.

> **Atenção:** não reutilizar `src/lib/dashboard/date-utils.ts`. Aquele módulo usa `setHours`/`getDay`, que leem o fuso do ambiente — seus testes falham hoje exatamente por isso. Na Vercel o servidor roda em UTC e a janela de expediente erraria por 3 horas.

- [ ] **Step 1: Escrever os testes**

Criar `src/lib/dashboard/business-hours.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';

import {
  businessMinutesBetween,
  isWithinBusinessHours,
} from './business-hours';

// Todas as datas em UTC explícito. O expediente é 07:00–19:00 em
// America/Sao_Paulo (UTC−3), ou seja 10:00–22:00 UTC. Escrever os
// fixtures em UTC evita depender do fuso da máquina que roda o teste —
// que é justamente o defeito de date-utils.ts.
const utc = (iso: string) => new Date(iso);

describe('isWithinBusinessHours', () => {
  it('reconhece o meio da manha de uma terca', () => {
    // Terça, 2026-08-04, 09:00 em São Paulo = 12:00 UTC
    expect(isWithinBusinessHours(utc('2026-08-04T12:00:00Z'))).toBe(true);
  });

  it('recusa antes da abertura', () => {
    // 06:59 São Paulo = 09:59 UTC
    expect(isWithinBusinessHours(utc('2026-08-04T09:59:00Z'))).toBe(false);
  });

  it('recusa depois do fechamento', () => {
    // 19:01 São Paulo = 22:01 UTC
    expect(isWithinBusinessHours(utc('2026-08-04T22:01:00Z'))).toBe(false);
  });

  it('recusa sabado e domingo mesmo em horario comercial', () => {
    // Sábado 2026-08-01 e domingo 2026-08-02, 12:00 São Paulo
    expect(isWithinBusinessHours(utc('2026-08-01T15:00:00Z'))).toBe(false);
    expect(isWithinBusinessHours(utc('2026-08-02T15:00:00Z'))).toBe(false);
  });
});

describe('businessMinutesBetween', () => {
  it('conta minutos corridos dentro do mesmo expediente', () => {
    // Terça 09:00 → 09:30 São Paulo
    expect(
      businessMinutesBetween(
        utc('2026-08-04T12:00:00Z'),
        utc('2026-08-04T12:30:00Z'),
      ),
    ).toBe(30);
  });

  it('ignora o intervalo fora do expediente na virada do dia', () => {
    // Terça 18:50 → quarta 07:10 São Paulo.
    // Conta 10 min na terça + 10 min na quarta = 20.
    expect(
      businessMinutesBetween(
        utc('2026-08-04T21:50:00Z'),
        utc('2026-08-05T10:10:00Z'),
      ),
    ).toBe(20);
  });

  it('atravessa o fim de semana sem contar sabado e domingo', () => {
    // Sexta 18:50 → segunda 07:10 São Paulo = 10 + 10 = 20 minutos.
    // É o caso que o cliente levantou: mensagem no fim da sexta não
    // pode acusar dois dias de atraso na segunda de manhã.
    expect(
      businessMinutesBetween(
        utc('2026-07-31T21:50:00Z'),
        utc('2026-08-03T10:10:00Z'),
      ),
    ).toBe(20);
  });

  it('devolve zero para intervalo inteiramente fora do expediente', () => {
    // Sábado 10:00 → domingo 10:00 São Paulo
    expect(
      businessMinutesBetween(
        utc('2026-08-01T13:00:00Z'),
        utc('2026-08-02T13:00:00Z'),
      ),
    ).toBe(0);
  });

  it('devolve zero quando o fim precede o inicio', () => {
    expect(
      businessMinutesBetween(
        utc('2026-08-04T12:30:00Z'),
        utc('2026-08-04T12:00:00Z'),
      ),
    ).toBe(0);
  });

  it('conta um dia inteiro de expediente como 720 minutos', () => {
    // Terça 07:00 → 19:00 São Paulo = 12 horas
    expect(
      businessMinutesBetween(
        utc('2026-08-04T10:00:00Z'),
        utc('2026-08-04T22:00:00Z'),
      ),
    ).toBe(720);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run src/lib/dashboard/business-hours.test.ts`
Expected: FAIL — `Cannot find module './business-hours'`.

- [ ] **Step 3: Implementar**

Criar `src/lib/dashboard/business-hours.ts`:

```typescript
// ============================================================
// Minutos de expediente entre dois instantes.
//
// O fuso é EXPLÍCITO e não pode ser herdado do ambiente: na Vercel o
// servidor roda em UTC e a janela erraria por 3 horas. O módulo
// `date-utils.ts` deste mesmo diretório usa setHours/getDay e é
// justamente por isso que seus testes falham — não reutilizar.
// ============================================================

const TIMEZONE = 'America/Sao_Paulo';
const OPEN_HOUR = 7;
const CLOSE_HOUR = 19;
const MINUTES_PER_STEP = 1;

/** Hora e dia da semana de um instante, lidos no fuso da escola. */
function localParts(at: Date): { weekday: number; minutes: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const parts = fmt.formatToParts(at);
  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? '';

  const weekdayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };

  return {
    weekday: weekdayMap[get('weekday')] ?? 0,
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
  };
}

/** Verdadeiro dentro de seg–sex, 07:00–19:00, no fuso da escola. */
export function isWithinBusinessHours(at: Date): boolean {
  const { weekday, minutes } = localParts(at);
  if (weekday === 0 || weekday === 6) return false;
  return minutes >= OPEN_HOUR * 60 && minutes < CLOSE_HOUR * 60;
}

/**
 * Minutos de expediente decorridos entre `from` e `to`.
 *
 * O relógio PAUSA fora da janela: uma mensagem de sexta às 18:50
 * acumula 10 minutos na sexta e só volta a contar segunda às 07:00 —
 * reflete o tempo de atendimento realmente devido, não o de calendário.
 *
 * Implementação por varredura de minuto. O uso real compara contra 30
 * minutos e para cedo; mesmo o pior caso (um fim de semana inteiro)
 * são poucos milhares de iterações, o que dispensa aritmética de
 * calendário e mantém a função obviamente correta.
 */
export function businessMinutesBetween(from: Date, to: Date): number {
  if (to <= from) return 0;

  let count = 0;
  const cursor = new Date(from);

  while (cursor < to) {
    if (isWithinBusinessHours(cursor)) count += MINUTES_PER_STEP;
    cursor.setUTCMinutes(cursor.getUTCMinutes() + MINUTES_PER_STEP);
  }

  return count;
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run src/lib/dashboard/business-hours.test.ts`
Expected: PASS (11 testes)

- [ ] **Step 5: Commit**

```bash
git add src/lib/dashboard/business-hours.ts src/lib/dashboard/business-hours.test.ts
git commit -m "feat(dashboard): minutos de expediente com fuso explicito

Conta so o tempo dentro de seg-sex 07-19h em America/Sao_Paulo, com o
relogio pausando fora da janela. Fuso explicito de proposito: date-
utils.ts usa setHours/getDay, le o fuso do ambiente e por isso seus
testes falham -- na Vercel, que roda em UTC, a janela erraria em 3h."
```

---

### Task 9: Card de alerta — sem resposta há 30 min

**Files:**
- Create: `supabase/migrations/20260731000002_awaiting_reply_rpc.sql`
- Modify: `src/lib/dashboard/queries.ts` (nova consulta)
- Modify: o componente de cards do Dashboard
- Modify: `messages/pt.json`, `messages/en.json`, `messages/ko.json`

**Interfaces:**
- Consumes: `businessMinutesBetween` e `isWithinBusinessHours` da Task 8.
- Produces: `loadAwaitingReply(db): Promise<{ count: number; withinHours: boolean }>`.

> **Nota de projeto.** `conversations` **não** guarda quem mandou a última
> mensagem — as colunas são `last_message_text` e `last_message_at`, e nada
> indica o remetente. Determinar "a última mensagem foi do contato" exige olhar
> `messages`, que é trabalho de SQL (uma linha por conversa, a mais recente).
> Fazer isso no cliente seria uma consulta por conversa. Por isso a regra vive
> numa função no banco, e o JavaScript fica só com a aritmética de expediente,
> que é onde o fuso importa. O repositório já usa esse padrão em
> `filter_contacts_by_tags` (migração 025).

- [ ] **Step 1: Escrever a função no banco**

Criar `supabase/migrations/20260731000002_awaiting_reply_rpc.sql`:

```sql
-- ============================================================
-- 20260731000002_awaiting_reply_rpc
--
-- Conversas abertas cuja ÚLTIMA mensagem é do contato — ou seja, a
-- organização é quem está devendo resposta.
--
-- Vive no banco porque "a última mensagem de cada conversa" é um
-- DISTINCT ON, que o PostgREST não expõe: pelo cliente sairia uma
-- consulta por conversa. A função devolve o instante daquela última
-- mensagem e deixa a conta de minutos de expediente para a aplicação,
-- que é onde o fuso é tratado explicitamente.
--
-- SECURITY INVOKER (padrão): as políticas de `conversations` e
-- `messages` continuam valendo para quem chama, então a função não
-- amplia acesso.
--
-- Idempotente — seguro re-executar.
-- ============================================================

CREATE OR REPLACE FUNCTION conversations_awaiting_reply(p_account_id UUID)
RETURNS TABLE (
  conversation_id  UUID,
  last_message_at  TIMESTAMPTZ,
  last_sender_type TEXT
)
LANGUAGE sql
STABLE
AS $$
  SELECT DISTINCT ON (m.conversation_id)
         m.conversation_id,
         m.created_at,
         m.sender_type
  FROM messages m
  JOIN conversations c ON c.id = m.conversation_id
  WHERE c.account_id = p_account_id
    AND c.status = 'open'
  ORDER BY m.conversation_id, m.created_at DESC
$$;

COMMENT ON FUNCTION conversations_awaiting_reply(UUID) IS
  'Última mensagem de cada conversa aberta da conta, com o tipo de '
  'remetente. Quem chama filtra por remetente e pelo tempo de '
  'expediente decorrido.';
```

> **Por que o `DISTINCT ON` não filtra por remetente.** Filtrar antes traria a
> última mensagem *do cliente*, não a última mensagem *da conversa* — e uma
> conversa já respondida voltaria a contar como pendente. O filtro por remetente
> precisa vir depois de escolher a última mensagem, e por isso fica do lado da
> aplicação.

- [ ] **Step 2: Aplicar em homologação**

```bash
npx supabase db push
```

Conferir no SQL Editor:

```sql
SELECT * FROM conversations_awaiting_reply('<id da conta>');
```

Expected: uma linha por conversa aberta, com o instante e o tipo de remetente da
última mensagem.

- [ ] **Step 3: Acrescentar as traduções**

Em `messages/pt.json`, no namespace `Dashboard`:

```json
"awaitingReply": "Sem resposta há +30 min",
"awaitingReplyEmpty": "Tudo respondido",
"awaitingReplyClosed": "Fora do horário de atendimento",
"awaitingReplyHint": "Conversas em que o contato falou por último e já passaram 30 minutos de expediente"
```

Em `messages/en.json` e `messages/ko.json`, os equivalentes.

- [ ] **Step 4: Implementar a consulta**

Em `src/lib/dashboard/queries.ts`, importando de `./business-hours`:

```typescript
/**
 * Conversas em que o contato falou por último e que já acumularam mais
 * de 30 minutos de EXPEDIENTE sem resposta. Fora do horário o card não
 * acusa atraso — às 22h de domingo ninguém está devendo resposta.
 */
export async function loadAwaitingReply(
  db: DB,
  accountId: string,
): Promise<{ count: number; withinHours: boolean }> {
  const now = new Date();
  if (!isWithinBusinessHours(now)) return { count: 0, withinHours: false };

  const { data } = await db.rpc('conversations_awaiting_reply', {
    p_account_id: accountId,
  });

  const rows = (data ?? []) as {
    last_message_at: string | null;
    last_sender_type: string | null;
  }[];

  const count = rows.filter((r) => {
    if (r.last_sender_type !== 'customer') return false;
    if (!r.last_message_at) return false;
    return businessMinutesBetween(new Date(r.last_message_at), now) > 30;
  }).length;

  return { count, withinHours: true };
}
```

- [ ] **Step 5: Substituir o card no Dashboard**

Trocar "Valor de Negócios Abertos" pelo novo card, que mostra:
- dentro do expediente e com pendências → a contagem, em tom de alerta
- dentro do expediente e sem pendências → `awaitingReplyEmpty`
- fora do expediente → `awaitingReplyClosed`, em tom neutro

Clicar leva ao Inbox.

- [ ] **Step 6: Verificar visualmente**

```bash
npx next dev -p 3005
```

Em homologação, mandar uma mensagem pelo número de teste e conferir que o card não acusa nada antes de 30 minutos. Para validar o limiar sem esperar, atualizar `last_message_at` de uma conversa de teste para 40 minutos atrás e recarregar.

- [ ] **Step 7: Rodar a suíte**

Run: `npx tsc --noEmit && npx vitest run`
Expected: sem erro de tipo; segue com os mesmos 5 testes pré-existentes falhando, nenhum novo.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/20260731000002_awaiting_reply_rpc.sql src/lib/dashboard/queries.ts src/app/\(dashboard\)/dashboard/ messages/
git commit -m "feat(dashboard): card de conversas sem resposta ha 30 min

Ocupa o lugar do valor de negocios abertos. Conta so minutos de
expediente, entao mensagem de sexta 18h50 nao aparece como dois dias de
atraso na segunda. Fora do horario o card fica neutro."
```

---

### Task 10: Módulo de vendas configurável

**Files:**
- Modify: `src/hooks/use-auth.tsx` (~linha 174, expor `disabledModules`)
- Create: `src/lib/accounts/modules.ts`
- Modify: `src/components/layout/sidebar.tsx` (~linha 92)
- Modify: `src/app/(dashboard)/pipelines/page.tsx` (bloqueio de rota)
- Modify: Dashboard e Configurações
- Test: `src/lib/accounts/modules.test.ts`

**Interfaces:**
- Consumes: `accounts.disabled_modules` da Task 3.
- Produces: `isModuleEnabled(disabled, 'sales'): boolean`.

- [ ] **Step 1: Escrever o teste**

Criar `src/lib/accounts/modules.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';

import { isModuleEnabled, MODULES } from './modules';

describe('isModuleEnabled', () => {
  it('tudo ligado quando nada foi desligado', () => {
    // Opt-out: conta existente, sem configuracao, mantem o
    // comportamento atual inteiro.
    expect(isModuleEnabled([], MODULES.SALES)).toBe(true);
  });

  it('desliga o modulo listado', () => {
    expect(isModuleEnabled(['sales'], MODULES.SALES)).toBe(false);
  });

  it('nao afeta modulos nao listados', () => {
    expect(isModuleEnabled(['outro'], MODULES.SALES)).toBe(true);
  });

  it('trata ausencia de configuracao como tudo ligado', () => {
    expect(isModuleEnabled(null, MODULES.SALES)).toBe(true);
    expect(isModuleEnabled(undefined, MODULES.SALES)).toBe(true);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npx vitest run src/lib/accounts/modules.test.ts`
Expected: FAIL — `Cannot find module './modules'`.

- [ ] **Step 3: Implementar**

Criar `src/lib/accounts/modules.ts`:

```typescript
/**
 * Módulos que uma conta pode desligar.
 *
 * Opt-out de propósito: `disabled_modules` vazio significa tudo
 * ligado, então nenhuma conta existente muda de comportamento quando a
 * coluna aparece. É o que permite um único código servir clientes de
 * ramos diferentes — a escola desliga vendas, um cliente de varejo
 * mantém.
 */
export const MODULES = {
  /** Pipelines, negócios e moeda. */
  SALES: 'sales',
} as const;

export type ModuleName = (typeof MODULES)[keyof typeof MODULES];

export function isModuleEnabled(
  disabledModules: string[] | null | undefined,
  moduleName: ModuleName,
): boolean {
  if (!disabledModules) return true;
  return !disabledModules.includes(moduleName);
}
```

- [ ] **Step 4: Rodar e confirmar que passa**

Run: `npx vitest run src/lib/accounts/modules.test.ts`
Expected: PASS (4 testes)

- [ ] **Step 5: Expor no hook de autenticação**

Em `src/hooks/use-auth.tsx`, acrescentar a coluna ao `select` da conta (~linha 174):

```typescript
            .select("id, name, default_currency, disabled_modules")
```

Levar `disabled_modules` para `AccountSummary` e expor `salesEnabled` no valor do contexto, calculado com `isModuleEnabled`.

- [ ] **Step 6: Filtrar o menu**

Em `src/components/layout/sidebar.tsx`, marcar o item e filtrar:

```typescript
const navItems: NavItem[] = [
  // …
  { href: "/pipelines", labelKey: "pipelines", icon: GitBranch, module: MODULES.SALES },
  // …
];
```

E, na renderização, pular os itens cujo módulo esteja desligado.

- [ ] **Step 7: Bloquear a rota**

Em `src/app/(dashboard)/pipelines/page.tsx`, redirecionar para `/dashboard` quando o módulo estiver desligado. **Esconder só o menu não protege** — quem souber a URL entra.

- [ ] **Step 8: Ocultar no Dashboard e nas Configurações**

Esconder o gráfico "Valor do Pipeline" e a ação "Novo Negócio" no Dashboard, e a seção "Negócios e moeda" nas Configurações, sempre pela mesma condição.

- [ ] **Step 9: Ligar na conta da escola**

> **AÇÃO DO USUÁRIO:** aplicar em homologação primeiro e conferir; só depois em produção.

```sql
UPDATE accounts
SET disabled_modules = ARRAY['sales']
WHERE id = '<id da conta da escola>';
```

- [ ] **Step 10: Verificar os dois lados**

Com o módulo desligado: Pipelines some do menu, `/pipelines` redireciona, o Dashboard não mostra o gráfico nem a ação, Configurações não mostra Negócios e moeda.
Com o módulo ligado (outra conta): tudo continua como hoje.

- [ ] **Step 11: Commit**

```bash
git add src/lib/accounts/ src/hooks/use-auth.tsx src/components/layout/sidebar.tsx src/app/\(dashboard\)/
git commit -m "feat(accounts): modulo de vendas desligavel por conta

Opt-out: disabled_modules vazio mantem tudo ligado, entao nenhuma conta
existente muda. A rota tambem e bloqueada, nao so o menu -- esconder
item de navegacao nao protege nada."
```

---

## Verificação final

Rodar ao término e conferir cada critério do spec:

- [ ] Mensagem enviada pelo painel grava `sender_id`; o balão mostra o autor e marca a troca de operador
- [ ] Envio por automação, broadcast e API pública segue funcionando, com autor nulo e rótulo "Sistema"
- [ ] Contato criado por mensagem recebida nasce `whatsapp` e exibe badge "Novo"; ao ser nomeado, deixa de exibir
- [ ] Arquivo `.xlsx` exportado do Excel em português importa sem perder acento
- [ ] Arquivo `.csv` salvo pelo Excel em português (separador `;`) importa corretamente
- [ ] Imagem recebida abre em tamanho real, pode ser baixada e não aparece cortada na miniatura
- [ ] `businessMinutesBetween` passa nos casos de virada de dia, fim de semana e intervalo fora do expediente
- [ ] Card de alerta conta uma mensagem de sexta 18:50 apenas a partir de segunda 07:00
- [ ] Conta com `disabled_modules = {'sales'}` não exibe Pipelines **e** bloqueia `/pipelines`
- [ ] Conta sem `disabled_modules` continua com todo o comportamento atual
- [ ] `npx vitest run` termina com os mesmos 5 testes pré-existentes falhando — nenhum novo

# Fundação Multi-Canal WhatsApp — Plano de Implementação (Parte A)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trocar a premissa "uma configuração de WhatsApp por conta" por "N canais por conta, de provedores diferentes", sem alterar nenhum comportamento observável do CRM.

**Architecture:** `whatsapp_config` vira `whatsapp_channels` (N linhas, coluna `provider`); `conversations` e `broadcasts` ganham `channel_id`; toda credencial passa a ser resolvida a partir da conversa através de um adapter `WhatsAppProvider`, cuja única implementação nesta parte é a Meta — um invólucro fino sobre o `meta-api.ts` existente, que não é modificado. O núcleo de ingestão de mensagens sai do webhook da Meta para ser compartilhado depois.

**Tech Stack:** Next.js 16 (App Router), TypeScript, Supabase (Postgres + RLS), Vitest.

**Spec:** [`docs/superpowers/specs/2026-07-27-uazapi-multicanal-design.md`](../specs/2026-07-27-uazapi-multicanal-design.md)

## Global Constraints

- **Nenhuma mudança de comportamento observável.** Ao final deste plano o CRM faz exatamente o que fazia antes. Toda tarefa é refactor ou preparação.
- **`src/lib/whatsapp/meta-api.ts` NÃO pode ser modificado.** É o arquivo que mais conflita em merges com o remote `upstream`. O adapter o embrulha.
- **Migrações são idempotentes e falham alto**, no estilo das 013 / 022 / 036: nunca deletar dados silenciosamente; se houver ambiguidade, `RAISE EXCEPTION` com instruções copiáveis.
- **Nenhuma coluna de token pode chegar ao cliente.** Nem criptografada.
- Testes rodam com `npm test` (Vitest, `environment: node`). O arquivo de teste fica ao lado do módulo: `foo.ts` → `foo.test.ts`.
- Verificação antes de cada commit: `npm test && npm run typecheck && npm run lint`.
- Branch de trabalho: `feat/uazapi-multicanal` (já criado).

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `supabase/migrations/037_whatsapp_channels.sql` | Rename, colunas novas, constraints, backfill, RLS |
| `src/lib/whatsapp/providers/types.ts` | Interface `WhatsAppProvider`, tipos de argumento, erros tipados |
| `src/lib/whatsapp/providers/meta.ts` | Adapter Meta — traduz a interface para `meta-api.ts` |
| `src/lib/whatsapp/providers/fake.ts` | `FakeProvider` para testes (grava chamadas em memória) |
| `src/lib/whatsapp/providers/resolve.ts` | Carrega canal, descriptografa credencial, devolve adapter |
| `src/lib/whatsapp/inbound/ingest.ts` | Núcleo de ingestão, independente de provedor |
| `src/app/api/whatsapp/channels/route.ts` | `GET` — lista canais sem campos sensíveis |
| `src/types/index.ts` | Tipo `WhatsAppChannel` substituindo `WhatsAppConfig` |

---

### Task 1: Migração do schema

**Files:**
- Create: `supabase/migrations/037_whatsapp_channels.sql`
- Modify: `src/types/index.ts:269-288`

**Interfaces:**
- Consumes: nada (primeira tarefa)
- Produces: tabela `whatsapp_channels`; colunas `conversations.channel_id` e `broadcasts.channel_id`; tipo TypeScript `WhatsAppChannel` com os campos `id, account_id, provider, label, phone_e164, status, connected_at, last_error, phone_number_id, waba_id, access_token, verify_token, registered_at, subscribed_apps_at, last_registration_error, uazapi_base_url, uazapi_token, uazapi_instance_id, webhook_secret, created_at, updated_at`

- [ ] **Step 1: Escrever a migração**

Criar `supabase/migrations/037_whatsapp_channels.sql`:

```sql
-- ============================================================
-- 037_whatsapp_channels
--
-- Troca "uma config de WhatsApp por conta" por "N canais por conta".
--
-- Por que renomear em vez de só adicionar colunas: `whatsapp_config`
-- no singular afirma a premissa que estamos removendo. As constraints
-- e políticas RLS precisam ser reescritas de qualquer forma
-- (UNIQUE(account_id) cai), então o rename não acrescenta risco.
--
-- Idempotente — seguro re-executar.
-- ============================================================

-- ─── 1. Rename ──────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'whatsapp_config')
     AND NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'whatsapp_channels')
  THEN
    ALTER TABLE whatsapp_config RENAME TO whatsapp_channels;
  END IF;
END $$;

-- ─── 2. Colunas novas ───────────────────────────────────────
ALTER TABLE whatsapp_channels
  ADD COLUMN IF NOT EXISTS provider           TEXT,
  ADD COLUMN IF NOT EXISTS label              TEXT,
  ADD COLUMN IF NOT EXISTS phone_e164         TEXT,
  ADD COLUMN IF NOT EXISTS last_error         TEXT,
  ADD COLUMN IF NOT EXISTS uazapi_base_url    TEXT,
  ADD COLUMN IF NOT EXISTS uazapi_token       TEXT,
  ADD COLUMN IF NOT EXISTS uazapi_instance_id TEXT,
  ADD COLUMN IF NOT EXISTS webhook_secret     TEXT;

-- Toda linha pré-existente é Meta por definição.
UPDATE whatsapp_channels SET provider = 'meta' WHERE provider IS NULL;
ALTER TABLE whatsapp_channels ALTER COLUMN provider SET NOT NULL;

-- `phone_number_id` e `access_token` eram NOT NULL: agora são nulos
-- em canais UAZAPI.
ALTER TABLE whatsapp_channels ALTER COLUMN phone_number_id DROP NOT NULL;
ALTER TABLE whatsapp_channels ALTER COLUMN access_token    DROP NOT NULL;

-- `status` ganha os estados de sessão da UAZAPI.
ALTER TABLE whatsapp_channels DROP CONSTRAINT IF EXISTS whatsapp_config_status_check;
ALTER TABLE whatsapp_channels DROP CONSTRAINT IF EXISTS whatsapp_channels_status_check;
ALTER TABLE whatsapp_channels
  ADD CONSTRAINT whatsapp_channels_status_check
  CHECK (status IN ('connected','disconnected','connecting','hibernated'));

-- ─── 3. Constraints ─────────────────────────────────────────

-- A mudança central: um canal deixa de ser único por conta.
ALTER TABLE whatsapp_channels DROP CONSTRAINT IF EXISTS whatsapp_config_account_id_key;
ALTER TABLE whatsapp_channels DROP CONSTRAINT IF EXISTS whatsapp_config_user_id_key;

-- UNIQUE(phone_number_id) passa a ser parcial: sem o WHERE, todos os
-- canais UAZAPI colidiriam em NULL. O raciocínio da 013 (um número
-- Meta por conta, para o webhook não ficar ambíguo) segue valendo.
ALTER TABLE whatsapp_channels DROP CONSTRAINT IF EXISTS whatsapp_config_phone_number_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_channels_phone_number_id
  ON whatsapp_channels (phone_number_id)
  WHERE phone_number_id IS NOT NULL;

-- Duas contas não podem reivindicar a mesma instância UAZAPI, ou o
-- inbound fica ambíguo.
CREATE UNIQUE INDEX IF NOT EXISTS idx_channels_uazapi_instance
  ON whatsapp_channels (uazapi_base_url, uazapi_instance_id)
  WHERE uazapi_base_url IS NOT NULL AND uazapi_instance_id IS NOT NULL;

-- Chave de roteamento do webhook de entrada.
CREATE UNIQUE INDEX IF NOT EXISTS idx_channels_webhook_secret
  ON whatsapp_channels (webhook_secret)
  WHERE webhook_secret IS NOT NULL;

-- Impede meia-configuração gravada no banco.
ALTER TABLE whatsapp_channels DROP CONSTRAINT IF EXISTS whatsapp_channels_provider_fields_check;
ALTER TABLE whatsapp_channels
  ADD CONSTRAINT whatsapp_channels_provider_fields_check
  CHECK (
    (provider = 'meta'   AND phone_number_id IS NOT NULL AND access_token IS NOT NULL)
    OR
    (provider = 'uazapi' AND uazapi_base_url IS NOT NULL AND uazapi_token IS NOT NULL)
  );

ALTER TABLE whatsapp_channels DROP CONSTRAINT IF EXISTS whatsapp_channels_provider_check;
ALTER TABLE whatsapp_channels
  ADD CONSTRAINT whatsapp_channels_provider_check
  CHECK (provider IN ('meta','uazapi'));

-- ─── 4. channel_id em conversations ─────────────────────────
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS channel_id UUID REFERENCES whatsapp_channels(id) ON DELETE SET NULL;

-- Backfill: hoje existe no máximo um canal por conta, então a escolha
-- é determinística — não há ambiguidade a resolver.
UPDATE conversations c
SET channel_id = ch.id
FROM whatsapp_channels ch
WHERE ch.account_id = c.account_id
  AND c.channel_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_channel ON conversations(channel_id);

-- A UNIQUE da 036 passa a incluir o canal: o mesmo contato pode falar
-- com dois números da conta, e são conversas distintas.
--
-- NULLS NOT DISTINCT é obrigatório. Sem ele, conversas órfãs
-- (channel_id NULL, após remoção de um canal) voltariam a duplicar —
-- exatamente o bug #363 que a 036 corrigiu, já que num índice único
-- comum o Postgres trata cada NULL como distinto.
DROP INDEX IF EXISTS idx_conversations_account_contact;
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_account_contact_channel
  ON conversations (account_id, contact_id, channel_id) NULLS NOT DISTINCT;

-- ─── 5. channel_id em broadcasts ────────────────────────────
-- Nullable de propósito: uma conta que apagou sua config antes desta
-- migração tem broadcasts históricos sem canal resolvível, e um
-- SET NOT NULL abortaria a migração inteira. Obrigatoriedade para
-- novos disparos vive na aplicação.
ALTER TABLE broadcasts
  ADD COLUMN IF NOT EXISTS channel_id UUID REFERENCES whatsapp_channels(id) ON DELETE SET NULL;

UPDATE broadcasts b
SET channel_id = ch.id
FROM whatsapp_channels ch
WHERE ch.account_id = b.account_id
  AND b.channel_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_broadcasts_channel ON broadcasts(channel_id);

-- ─── 6. RLS ─────────────────────────────────────────────────
-- Espelha o padrão da 017: membros leem, admins+ escrevem.
ALTER TABLE whatsapp_channels ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can manage own config" ON whatsapp_channels;
DROP POLICY IF EXISTS "members read channels"       ON whatsapp_channels;
DROP POLICY IF EXISTS "admins write channels"       ON whatsapp_channels;

CREATE POLICY "members read channels" ON whatsapp_channels
  FOR SELECT USING (
    account_id IN (SELECT account_id FROM profiles WHERE user_id = auth.uid())
  );

CREATE POLICY "admins write channels" ON whatsapp_channels
  FOR ALL USING (
    account_id IN (
      SELECT account_id FROM profiles
      WHERE user_id = auth.uid() AND role IN ('owner','admin')
    )
  );
```

- [ ] **Step 2: Aplicar e conferir**

Rodar a migração no Supabase local ou de staging, depois conferir:

```sql
SELECT provider, count(*) FROM whatsapp_channels GROUP BY provider;
SELECT count(*) FROM conversations WHERE channel_id IS NULL;
```

Esperado: toda linha com `provider='meta'`; zero conversas com `channel_id NULL`
em contas que têm canal.

- [ ] **Step 3: Atualizar o tipo TypeScript**

Substituir `WhatsAppConfig` em `src/types/index.ts:269-288` por:

```ts
export type WhatsAppProviderKind = 'meta' | 'uazapi';

export interface WhatsAppChannel {
  id: string;
  account_id: string;
  provider: WhatsAppProviderKind;
  /** Nome dado pelo usuário: "Recepção", "Financeiro". */
  label?: string;
  /** Número conectado; preenchido após a conexão. */
  phone_e164?: string;
  status: 'connected' | 'disconnected' | 'connecting' | 'hibernated';
  connected_at?: string;
  last_error?: string;

  // Meta — nulos quando provider === 'uazapi'
  phone_number_id?: string;
  waba_id?: string;
  access_token?: string;
  verify_token?: string;
  registered_at?: string;
  subscribed_apps_at?: string;
  last_registration_error?: string;

  // UAZAPI — nulos quando provider === 'meta'
  uazapi_base_url?: string;
  uazapi_token?: string;
  uazapi_instance_id?: string;
  /** Segredo por canal; é a chave de roteamento do webhook de entrada. */
  webhook_secret?: string;

  created_at?: string;
  updated_at?: string;
}
```

- [ ] **Step 4: Trocar as referências à tabela antiga**

Substituir `from('whatsapp_config')` por `from('whatsapp_channels')` nos 17
arquivos. Localizar com:

```bash
grep -rln "whatsapp_config" src/
```

Nesta tarefa é uma troca mecânica de nome — a lógica de `.single()` continua
como está e será tratada na Task 5. O objetivo aqui é apenas voltar a compilar.

- [ ] **Step 5: Verificar**

```bash
npm run typecheck && npm test
```

Esperado: sem erros de tipo; suíte verde.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/037_whatsapp_channels.sql src/types/index.ts src/
git commit -m "feat(db): whatsapp_config vira whatsapp_channels com N canais por conta"
```

---

### Task 2: Interface do provider e erros tipados

**Files:**
- Create: `src/lib/whatsapp/providers/types.ts`
- Test: `src/lib/whatsapp/providers/types.test.ts`

**Interfaces:**
- Consumes: `WhatsAppProviderKind` (Task 1); `MediaKind`, `InteractiveButton`, `InteractiveListSection` de `@/lib/whatsapp/meta-api`
- Produces: interface `WhatsAppProvider`; tipo `SendResult = { messageId: string }`; classes `ProviderError`, `ProviderUnsupportedError`, `ProviderRateLimitError`, `ProviderNotConnectedError`

- [ ] **Step 1: Escrever o teste que falha**

Criar `src/lib/whatsapp/providers/types.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  ProviderError,
  ProviderNotConnectedError,
  ProviderRateLimitError,
  ProviderUnsupportedError,
} from "./types";

describe("ProviderUnsupportedError", () => {
  it("nomeia a capacidade ausente e o provedor", () => {
    const err = new ProviderUnsupportedError("uazapi", "sendTemplate");
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.provider).toBe("uazapi");
    expect(err.capability).toBe("sendTemplate");
    expect(err.message).toContain("sendTemplate");
    expect(err.message).toContain("uazapi");
  });
});

describe("ProviderRateLimitError", () => {
  it("carrega o error_key e o código do provedor", () => {
    // O 463 do WhatsApp: a conta está temporariamente impedida de
    // iniciar novas conversas. Um broadcast que receba isso deve
    // parar, não repetir.
    const err = new ProviderRateLimitError("uazapi", {
      errorKey: "WHATSAPP_REACHOUT_TIMELOCK",
      providerCode: 463,
      providerMessage: "WhatsApp reported a temporary restriction.",
    });
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.errorKey).toBe("WHATSAPP_REACHOUT_TIMELOCK");
    expect(err.providerCode).toBe(463);
  });

  it("aceita ausência de detalhes do provedor", () => {
    const err = new ProviderRateLimitError("meta", {});
    expect(err.errorKey).toBeUndefined();
    expect(err.providerCode).toBeUndefined();
  });
});

describe("ProviderNotConnectedError", () => {
  it("identifica o canal para a UI conseguir apontar o problema", () => {
    const err = new ProviderNotConnectedError("uazapi", "chan-123", "hibernated");
    expect(err.channelId).toBe("chan-123");
    expect(err.status).toBe("hibernated");
  });
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `npx vitest run src/lib/whatsapp/providers/types.test.ts`
Expected: FAIL — `Failed to resolve import "./types"`

- [ ] **Step 3: Escrever a implementação mínima**

Criar `src/lib/whatsapp/providers/types.ts`:

```ts
// ============================================================
// Contrato que todo provedor de WhatsApp implementa.
//
// A fronteira fica no nível das *primitivas de envio* — o mesmo
// nível que `meta-api.ts` já expõe. Isso é deliberado: inbox,
// broadcasts, flows, automations e AI auto-reply todos desembocam
// nessas primitivas, então trocá-las por um adapter faz os cinco
// caminhos funcionarem em qualquer provedor sem alteração própria.
// ============================================================

import type {
  InteractiveButton,
  InteractiveListSection,
  MediaKind,
} from "@/lib/whatsapp/meta-api";
import type { WhatsAppProviderKind } from "@/types";

/** Idêntico a `MetaSendResult` — os call sites não mudam de contrato. */
export interface SendResult {
  messageId: string;
}

export class ProviderError extends Error {
  readonly provider: WhatsAppProviderKind;
  constructor(provider: WhatsAppProviderKind, message: string) {
    super(message);
    this.name = "ProviderError";
    this.provider = provider;
  }
}

/**
 * A capacidade não existe neste provedor. Templates aprovados, por
 * exemplo, são exclusivos da Meta. A UI esconde o que não se aplica;
 * este erro é a rede de proteção para um caminho que não deveria ser
 * alcançável.
 */
export class ProviderUnsupportedError extends ProviderError {
  readonly capability: string;
  constructor(provider: WhatsAppProviderKind, capability: string) {
    super(provider, `"${capability}" não é suportado pelo provedor ${provider}.`);
    this.name = "ProviderUnsupportedError";
    this.capability = capability;
  }
}

export interface ProviderRateLimitDetails {
  /** Ex.: "WHATSAPP_REACHOUT_TIMELOCK". */
  errorKey?: string;
  /** Código numérico do provedor upstream. Ex.: 463. */
  providerCode?: number;
  providerMessage?: string;
}

/**
 * O provedor upstream recusou por limite ou qualidade.
 *
 * Importante: quem trata isso num envio em massa deve **parar**, não
 * repetir. Insistir queima a reputação do número e escala para
 * banimento — e número banido é perda permanente.
 */
export class ProviderRateLimitError extends ProviderError {
  readonly errorKey?: string;
  readonly providerCode?: number;
  readonly providerMessage?: string;
  constructor(provider: WhatsAppProviderKind, details: ProviderRateLimitDetails) {
    super(provider, details.providerMessage ?? "Provedor recusou por limite de envio.");
    this.name = "ProviderRateLimitError";
    this.errorKey = details.errorKey;
    this.providerCode = details.providerCode;
    this.providerMessage = details.providerMessage;
  }
}

/** O canal não está conectado; falha antes de sair da aplicação. */
export class ProviderNotConnectedError extends ProviderError {
  readonly channelId: string;
  readonly status: string;
  constructor(provider: WhatsAppProviderKind, channelId: string, status: string) {
    super(provider, `O canal ${channelId} não está conectado (status: ${status}).`);
    this.name = "ProviderNotConnectedError";
    this.channelId = channelId;
    this.status = status;
  }
}

export interface SendTextArgs {
  to: string;
  text: string;
  /** Id (do provedor) da mensagem sendo respondida — gera a citação. */
  contextMessageId?: string;
}

export interface SendMediaArgs {
  to: string;
  kind: MediaKind;
  /** URL pública que o provedor busca no momento do envio. */
  link: string;
  caption?: string;
  /** Só para documentos; é o nome exibido no chat. */
  filename?: string;
  contextMessageId?: string;
}

export interface SendInteractiveButtonsArgs {
  to: string;
  bodyText: string;
  headerText?: string;
  footerText?: string;
  buttons: InteractiveButton[];
  contextMessageId?: string;
}

export interface SendInteractiveListArgs {
  to: string;
  bodyText: string;
  buttonLabel: string;
  headerText?: string;
  footerText?: string;
  sections: InteractiveListSection[];
  contextMessageId?: string;
}

export interface SendReactionArgs {
  to: string;
  targetMessageId: string;
  /** Emoji único, ou string vazia para remover a reação. */
  emoji: string;
}

export interface SendTemplateArgs {
  to: string;
  templateName: string;
  language: string;
  /** Linha local do template (header/botões). Tipada como unknown para
   *  não acoplar o contrato ao schema de templates da Meta. */
  template?: unknown;
  messageParams?: unknown;
  params?: string[];
  contextMessageId?: string;
}

export interface WhatsAppProvider {
  readonly kind: WhatsAppProviderKind;
  sendText(args: SendTextArgs): Promise<SendResult>;
  sendMedia(args: SendMediaArgs): Promise<SendResult>;
  sendInteractiveButtons(args: SendInteractiveButtonsArgs): Promise<SendResult>;
  sendInteractiveList(args: SendInteractiveListArgs): Promise<SendResult>;
  sendReaction(args: SendReactionArgs): Promise<SendResult>;
  sendTemplate(args: SendTemplateArgs): Promise<SendResult>;
  /**
   * Converte a referência de mídia recebida na URL que o CRM guarda.
   * Meta devolve um proxy preguiçoso; UAZAPI baixa para o Storage.
   */
  resolveInboundMediaUrl(ref: string): Promise<string | null>;
}
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `npx vitest run src/lib/whatsapp/providers/types.test.ts`
Expected: PASS — 4 testes

- [ ] **Step 5: Commit**

```bash
git add src/lib/whatsapp/providers/types.ts src/lib/whatsapp/providers/types.test.ts
git commit -m "feat(whatsapp): interface WhatsAppProvider e erros tipados"
```

---

### Task 3: Adapter da Meta e FakeProvider

**Files:**
- Create: `src/lib/whatsapp/providers/meta.ts`
- Create: `src/lib/whatsapp/providers/fake.ts`
- Test: `src/lib/whatsapp/providers/meta.test.ts`

**Interfaces:**
- Consumes: `WhatsAppProvider` e os tipos de argumento (Task 2)
- Produces: `createMetaProvider(config: MetaProviderConfig): WhatsAppProvider` onde `MetaProviderConfig = { phoneNumberId: string; accessToken: string }`; `createFakeProvider(): FakeProvider` com a propriedade `calls: FakeCall[]` e `FakeCall = { method: string; args: unknown }`

- [ ] **Step 1: Escrever o teste que falha**

Criar `src/lib/whatsapp/providers/meta.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMetaProvider } from "./meta";
import { ProviderUnsupportedError } from "./types";

// O adapter delega para meta-api.ts sem lógica própria. Mockar o
// módulo prova a delegação — que é a única coisa que ele faz.
vi.mock("@/lib/whatsapp/meta-api", () => ({
  sendTextMessage: vi.fn(async () => ({ messageId: "wamid.TEXT" })),
  sendMediaMessage: vi.fn(async () => ({ messageId: "wamid.MEDIA" })),
  sendReactionMessage: vi.fn(async () => ({ messageId: "wamid.REACT" })),
  sendInteractiveButtons: vi.fn(async () => ({ messageId: "wamid.BTN" })),
  sendInteractiveList: vi.fn(async () => ({ messageId: "wamid.LIST" })),
  sendTemplateMessage: vi.fn(async () => ({ messageId: "wamid.TPL" })),
}));

import {
  sendMediaMessage,
  sendTextMessage,
} from "@/lib/whatsapp/meta-api";

const config = { phoneNumberId: "PNID", accessToken: "TOKEN" };

describe("createMetaProvider", () => {
  beforeEach(() => vi.clearAllMocks());

  it("se identifica como meta", () => {
    expect(createMetaProvider(config).kind).toBe("meta");
  });

  it("injeta as credenciais no sendText — o call site não as vê", () => {
    const provider = createMetaProvider(config);
    return provider
      .sendText({ to: "5511999999999", text: "oi" })
      .then((result) => {
        expect(result).toEqual({ messageId: "wamid.TEXT" });
        expect(sendTextMessage).toHaveBeenCalledWith({
          phoneNumberId: "PNID",
          accessToken: "TOKEN",
          to: "5511999999999",
          text: "oi",
          contextMessageId: undefined,
        });
      });
  });

  it("repassa kind, link, caption e filename no sendMedia", async () => {
    const provider = createMetaProvider(config);
    await provider.sendMedia({
      to: "5511999999999",
      kind: "document",
      link: "https://exemplo.com/a.pdf",
      caption: "segue",
      filename: "Contrato.pdf",
    });
    expect(sendMediaMessage).toHaveBeenCalledWith({
      phoneNumberId: "PNID",
      accessToken: "TOKEN",
      to: "5511999999999",
      kind: "document",
      link: "https://exemplo.com/a.pdf",
      caption: "segue",
      filename: "Contrato.pdf",
      contextMessageId: undefined,
    });
  });

  it("resolve mídia recebida para a rota de proxy, não para a URL da Meta", async () => {
    // A URL da Meta expira e exige o token da conta; o proxy resolve
    // sob demanda com a credencial do lado do servidor.
    const provider = createMetaProvider(config);
    await expect(provider.resolveInboundMediaUrl("MEDIA_ID")).resolves.toBe(
      "/api/whatsapp/media/MEDIA_ID",
    );
  });
});

describe("ProviderUnsupportedError na Meta", () => {
  it("não é lançado para templates — a Meta suporta", async () => {
    const provider = createMetaProvider(config);
    await expect(
      provider.sendTemplate({ to: "55119", templateName: "hello", language: "pt_BR" }),
    ).resolves.toEqual({ messageId: "wamid.TPL" });
  });
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `npx vitest run src/lib/whatsapp/providers/meta.test.ts`
Expected: FAIL — `Failed to resolve import "./meta"`

- [ ] **Step 3: Escrever o adapter da Meta**

Criar `src/lib/whatsapp/providers/meta.ts`:

```ts
// ============================================================
// Adapter da Meta — invólucro fino sobre `meta-api.ts`.
//
// NÃO contém lógica: só injeta as credenciais do canal e repassa.
// `meta-api.ts` permanece intocado de propósito — é o arquivo que
// mais conflita em merges com o remote `upstream`.
// ============================================================

import {
  sendInteractiveButtons as metaSendInteractiveButtons,
  sendInteractiveList as metaSendInteractiveList,
  sendMediaMessage,
  sendReactionMessage,
  sendTemplateMessage,
  sendTextMessage,
} from "@/lib/whatsapp/meta-api";
import type { MessageTemplate } from "@/types";

import type {
  SendInteractiveButtonsArgs,
  SendInteractiveListArgs,
  SendMediaArgs,
  SendReactionArgs,
  SendResult,
  SendTemplateArgs,
  SendTextArgs,
  WhatsAppProvider,
} from "./types";

export interface MetaProviderConfig {
  phoneNumberId: string;
  accessToken: string;
}

export function createMetaProvider(config: MetaProviderConfig): WhatsAppProvider {
  const { phoneNumberId, accessToken } = config;
  const creds = { phoneNumberId, accessToken };

  return {
    kind: "meta",

    async sendText(args: SendTextArgs): Promise<SendResult> {
      return sendTextMessage({
        ...creds,
        to: args.to,
        text: args.text,
        contextMessageId: args.contextMessageId,
      });
    },

    async sendMedia(args: SendMediaArgs): Promise<SendResult> {
      return sendMediaMessage({
        ...creds,
        to: args.to,
        kind: args.kind,
        link: args.link,
        caption: args.caption,
        filename: args.filename,
        contextMessageId: args.contextMessageId,
      });
    },

    async sendInteractiveButtons(
      args: SendInteractiveButtonsArgs,
    ): Promise<SendResult> {
      return metaSendInteractiveButtons({
        ...creds,
        to: args.to,
        bodyText: args.bodyText,
        headerText: args.headerText,
        footerText: args.footerText,
        buttons: args.buttons,
        contextMessageId: args.contextMessageId,
      });
    },

    async sendInteractiveList(args: SendInteractiveListArgs): Promise<SendResult> {
      return metaSendInteractiveList({
        ...creds,
        to: args.to,
        bodyText: args.bodyText,
        buttonLabel: args.buttonLabel,
        headerText: args.headerText,
        footerText: args.footerText,
        sections: args.sections,
        contextMessageId: args.contextMessageId,
      });
    },

    async sendReaction(args: SendReactionArgs): Promise<SendResult> {
      return sendReactionMessage({
        ...creds,
        to: args.to,
        targetMessageId: args.targetMessageId,
        emoji: args.emoji,
      });
    },

    async sendTemplate(args: SendTemplateArgs): Promise<SendResult> {
      return sendTemplateMessage({
        ...creds,
        to: args.to,
        templateName: args.templateName,
        language: args.language,
        template: (args.template as MessageTemplate | undefined) ?? undefined,
        messageParams: args.messageParams,
        params: args.params ?? [],
        contextMessageId: args.contextMessageId,
      });
    },

    async resolveInboundMediaUrl(ref: string): Promise<string | null> {
      // A URL direta da Meta expira e exige o token da conta. O proxy
      // resolve sob demanda com a credencial do lado do servidor.
      if (!ref) return null;
      return `/api/whatsapp/media/${ref}`;
    },
  };
}
```

- [ ] **Step 4: Escrever o FakeProvider**

Criar `src/lib/whatsapp/providers/fake.ts`:

```ts
// ============================================================
// Provider em memória para testes.
//
// Existe para que send-message, broadcasts e flows possam ser
// testados sem mockar `fetch` — que é como os testes atuais sofrem.
// ============================================================

import type {
  SendInteractiveButtonsArgs,
  SendInteractiveListArgs,
  SendMediaArgs,
  SendReactionArgs,
  SendResult,
  SendTemplateArgs,
  SendTextArgs,
  WhatsAppProvider,
} from "./types";

export interface FakeCall {
  method: string;
  args: unknown;
}

export interface FakeProvider extends WhatsAppProvider {
  /** Toda chamada recebida, em ordem. */
  readonly calls: FakeCall[];
}

export interface FakeProviderOptions {
  /** Id devolvido por qualquer envio. Default: "fake-message-id". */
  messageId?: string;
  /** Se definido, todo envio rejeita com este erro. */
  failWith?: Error;
}

export function createFakeProvider(
  options: FakeProviderOptions = {},
): FakeProvider {
  const { messageId = "fake-message-id", failWith } = options;
  const calls: FakeCall[] = [];

  const record = async (method: string, args: unknown): Promise<SendResult> => {
    calls.push({ method, args });
    if (failWith) throw failWith;
    return { messageId };
  };

  return {
    kind: "meta",
    calls,
    sendText: (args: SendTextArgs) => record("sendText", args),
    sendMedia: (args: SendMediaArgs) => record("sendMedia", args),
    sendInteractiveButtons: (args: SendInteractiveButtonsArgs) =>
      record("sendInteractiveButtons", args),
    sendInteractiveList: (args: SendInteractiveListArgs) =>
      record("sendInteractiveList", args),
    sendReaction: (args: SendReactionArgs) => record("sendReaction", args),
    sendTemplate: (args: SendTemplateArgs) => record("sendTemplate", args),
    async resolveInboundMediaUrl(ref: string) {
      calls.push({ method: "resolveInboundMediaUrl", args: ref });
      return `/fake-media/${ref}`;
    },
  };
}
```

- [ ] **Step 5: Rodar os testes e ver passar**

Run: `npx vitest run src/lib/whatsapp/providers/`
Expected: PASS — todos os testes de `types.test.ts` e `meta.test.ts`

- [ ] **Step 6: Commit**

```bash
git add src/lib/whatsapp/providers/meta.ts src/lib/whatsapp/providers/fake.ts src/lib/whatsapp/providers/meta.test.ts
git commit -m "feat(whatsapp): adapter da Meta e FakeProvider para testes"
```

---

### Task 4: Resolver de provider

**Files:**
- Create: `src/lib/whatsapp/providers/resolve.ts`
- Test: `src/lib/whatsapp/providers/resolve.test.ts`

**Interfaces:**
- Consumes: `createMetaProvider` (Task 3); `ProviderNotConnectedError` (Task 2); `decrypt` de `@/lib/whatsapp/encryption`
- Produces: `getProviderForChannel(db: SupabaseClient, channelId: string): Promise<WhatsAppProvider>`; `getProviderForConversation(db: SupabaseClient, conversationId: string, accountId: string): Promise<WhatsAppProvider>`; `ChannelNotFoundError`

- [ ] **Step 1: Escrever o teste que falha**

Criar `src/lib/whatsapp/providers/resolve.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { encrypt } from "@/lib/whatsapp/encryption";
import { ProviderNotConnectedError } from "./types";
import { ChannelNotFoundError, getProviderForChannel } from "./resolve";

/**
 * Stub mínimo do SupabaseClient: só o encadeamento
 * from().select().eq().maybeSingle() que o resolver usa.
 */
function stubDb(row: Record<string, unknown> | null) {
  return {
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                async maybeSingle() {
                  return { data: row, error: null };
                },
              };
            },
          };
        },
      };
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const metaRow = {
  id: "chan-1",
  account_id: "acc-1",
  provider: "meta",
  status: "connected",
  phone_number_id: "PNID",
  access_token: encrypt("TOKEN-EM-CLARO"),
};

describe("getProviderForChannel", () => {
  it("devolve um adapter da Meta já carregado com a credencial", async () => {
    const provider = await getProviderForChannel(stubDb(metaRow), "chan-1");
    expect(provider.kind).toBe("meta");
  });

  it("lança ChannelNotFoundError quando o canal não existe", async () => {
    await expect(
      getProviderForChannel(stubDb(null), "inexistente"),
    ).rejects.toBeInstanceOf(ChannelNotFoundError);
  });

  it("recusa canal desconectado antes de qualquer chamada de rede", async () => {
    // Sem isso o atendente escreve, "envia", e a mensagem some.
    const desconectado = { ...metaRow, status: "disconnected" };
    await expect(
      getProviderForChannel(stubDb(desconectado), "chan-1"),
    ).rejects.toBeInstanceOf(ProviderNotConnectedError);
  });

  it("nunca devolve o token ao chamador", async () => {
    const provider = await getProviderForChannel(stubDb(metaRow), "chan-1");
    expect(JSON.stringify(Object.keys(provider))).not.toContain("access_token");
    expect(JSON.stringify(Object.keys(provider))).not.toContain("token");
  });
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `npx vitest run src/lib/whatsapp/providers/resolve.test.ts`
Expected: FAIL — `Failed to resolve import "./resolve"`

- [ ] **Step 3: Escrever o resolver**

Criar `src/lib/whatsapp/providers/resolve.ts`:

```ts
// ============================================================
// Resolve o provider a partir do canal ou da conversa.
//
// Esta é a peça que faz a segurança funcionar: o adapter volta com
// a credencial já injetada, então nenhum call site volta a manipular
// token. Some o padrão `decrypt(config.access_token)` repetido em
// seis arquivos, e some com ele a chance de um token vazar num log.
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";

import { decrypt } from "@/lib/whatsapp/encryption";
import type { WhatsAppChannel } from "@/types";

import { createMetaProvider } from "./meta";
import {
  ProviderNotConnectedError,
  ProviderUnsupportedError,
  type WhatsAppProvider,
} from "./types";

export class ChannelNotFoundError extends Error {
  readonly channelId: string;
  constructor(channelId: string) {
    super(`Canal ${channelId} não encontrado.`);
    this.name = "ChannelNotFoundError";
    this.channelId = channelId;
  }
}

export class ConversationHasNoChannelError extends Error {
  readonly conversationId: string;
  constructor(conversationId: string) {
    super(
      `A conversa ${conversationId} não está vinculada a um canal. ` +
        `Isso acontece quando o canal de origem foi removido; a conversa ` +
        `fica como histórico somente-leitura.`,
    );
    this.name = "ConversationHasNoChannelError";
    this.conversationId = conversationId;
  }
}

function buildProvider(channel: WhatsAppChannel): WhatsAppProvider {
  if (channel.status !== "connected") {
    throw new ProviderNotConnectedError(
      channel.provider,
      channel.id,
      channel.status,
    );
  }

  if (channel.provider === "meta") {
    return createMetaProvider({
      phoneNumberId: channel.phone_number_id!,
      accessToken: decrypt(channel.access_token!),
    });
  }

  // O provider UAZAPI entra aqui na Parte B do plano.
  throw new ProviderUnsupportedError(channel.provider, "createProvider");
}

export async function getProviderForChannel(
  db: SupabaseClient,
  channelId: string,
): Promise<WhatsAppProvider> {
  const { data, error } = await db
    .from("whatsapp_channels")
    .select("*")
    .eq("id", channelId)
    .maybeSingle();

  if (error || !data) throw new ChannelNotFoundError(channelId);
  return buildProvider(data as WhatsAppChannel);
}

/**
 * Resolve o provider a partir da conversa — o caminho que a maioria
 * dos call sites usa. `accountId` mantém o escopo de tenancy mesmo
 * quando `db` é o cliente service-role.
 */
export async function getProviderForConversation(
  db: SupabaseClient,
  conversationId: string,
  accountId: string,
): Promise<WhatsAppProvider> {
  const { data, error } = await db
    .from("conversations")
    .select("channel_id")
    .eq("id", conversationId)
    .eq("account_id", accountId)
    .maybeSingle();

  if (error || !data) throw new ChannelNotFoundError(conversationId);
  if (!data.channel_id) throw new ConversationHasNoChannelError(conversationId);

  return getProviderForChannel(db, data.channel_id as string);
}
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `npx vitest run src/lib/whatsapp/providers/resolve.test.ts`
Expected: PASS — 4 testes

- [ ] **Step 5: Commit**

```bash
git add src/lib/whatsapp/providers/resolve.ts src/lib/whatsapp/providers/resolve.test.ts
git commit -m "feat(whatsapp): resolver de provider por canal e por conversa"
```

---

### Task 5: Migrar os call sites de envio

**Files:**
- Modify: `src/lib/whatsapp/send-message.ts:250-396`
- Modify: `src/lib/whatsapp/broadcast-core.ts`
- Modify: `src/lib/flows/meta-send.ts` → renomear para `src/lib/flows/send.ts`
- Modify: `src/lib/automations/meta-send.ts` → renomear para `src/lib/automations/send.ts`
- Modify: `src/app/api/whatsapp/react/route.ts`
- Modify: `src/lib/ai/auto-reply.ts`
- Test: `src/lib/whatsapp/send-message.test.ts`

**Interfaces:**
- Consumes: `getProviderForConversation` (Task 4); `createFakeProvider` (Task 3)
- Produces: nenhuma assinatura pública nova — `sendMessageToConversation` mantém a mesma

Esta tarefa é um **refactor puro**, não uma feature — não há comportamento novo
para um teste novo capturar. A rede de proteção é a suíte que já existe
(`send-message.test.ts`, `broadcast-core.test.ts`) mais as duas verificações
mecânicas do Step 4. Por isso ela não começa por um teste que falha: começaria
por um teste que passa antes e depois, o que não prova nada.

- [ ] **Step 1: Registrar o estado verde de partida**

Run: `npm test`
Expected: PASS. Anote o número de testes — ele não pode diminuir ao fim da
tarefa. Se a suíte já estiver vermelha, **pare e conserte antes**: sem base
verde, o refactor não tem como ser verificado.

- [ ] **Step 2: Trocar o bloco de envio de `send-message.ts`**

Em `src/lib/whatsapp/send-message.ts`, remover o carregamento de config e a
descriptografia (linhas ~250-281) e substituir a função `attempt`
(linhas ~332-396) por:

```ts
  const provider = await getProviderForConversation(db, conversationId, accountId);

  const attempt = async (phone: string): Promise<string> => {
    if (messageType === 'template') {
      const result = await provider.sendTemplate({
        to: phone,
        templateName: templateName!,
        language: templateLanguage || 'en_US',
        template: templateRow ?? undefined,
        messageParams: templateMessageParams ?? undefined,
        params: templateParams || [],
        contextMessageId,
      });
      return result.messageId;
    }
    if (isMediaKind) {
      const result = await provider.sendMedia({
        to: phone,
        kind: messageType as MediaKind,
        link: mediaUrl!,
        caption: contentText || undefined,
        filename: filename || undefined,
        contextMessageId,
      });
      return result.messageId;
    }
    if (messageType === 'interactive') {
      const p = interactivePayload!;
      if (p.kind === 'buttons') {
        const result = await provider.sendInteractiveButtons({
          to: phone,
          bodyText: p.body,
          headerText: p.header || undefined,
          footerText: p.footer || undefined,
          buttons: p.buttons,
          contextMessageId,
        });
        return result.messageId;
      }
      const result = await provider.sendInteractiveList({
        to: phone,
        bodyText: p.body,
        buttonLabel: p.button_label,
        headerText: p.header || undefined,
        footerText: p.footer || undefined,
        sections: p.sections,
        contextMessageId,
      });
      return result.messageId;
    }
    const result = await provider.sendText({
      to: phone,
      text: contentText!,
      contextMessageId,
    });
    return result.messageId;
  };
```

Ajustar os imports no topo: remover `sendTextMessage`, `sendTemplateMessage`,
`sendMediaMessage`, `sendInteractiveButtons`, `sendInteractiveList`, `decrypt`,
`encrypt`, `isLegacyFormat`; acrescentar:

```ts
import { getProviderForConversation } from '@/lib/whatsapp/providers/resolve';
```

Manter `import { type MediaKind } from '@/lib/whatsapp/meta-api'`.

O bloco de auto-upgrade de ciphertext CBC→GCM (linhas ~267-281) sai daqui: a
descriptografia agora vive no resolver, e o upgrade oportunista deixa de ter
lugar neste arquivo. Registre a remoção na mensagem do commit.

- [ ] **Step 3: Repetir o padrão nos outros cinco arquivos**

Para cada um, o padrão é idêntico: onde existir

```ts
const { data: config } = await db.from('whatsapp_channels').select('*').eq('account_id', accountId).single()
const accessToken = decrypt(config.access_token)
await sendTextMessage({ phoneNumberId: config.phone_number_id, accessToken, to, text })
```

substituir por

```ts
const provider = await getProviderForConversation(db, conversationId, accountId)
await provider.sendText({ to, text })
```

Nos motores de flows e automations, que trabalham a partir do contato e não da
conversa, resolver a conversa primeiro (elas já a carregam para gravar a
mensagem) e usar `getProviderForConversation`.

Renomear os dois arquivos e atualizar quem os importa:

```bash
git mv src/lib/flows/meta-send.ts src/lib/flows/send.ts
git mv src/lib/automations/meta-send.ts src/lib/automations/send.ts
grep -rln "meta-send" src/ | xargs sed -i "s#/meta-send#/send#g"
```

- [ ] **Step 4: Verificar**

```bash
npm test && npm run typecheck && npm run lint
```

Esperado: suíte verde com **o mesmo número de testes do Step 1**, sem erros de
tipo, sem lint. Nenhum comportamento mudou — apenas a origem da primitiva de
envio.

Duas verificações mecânicas do objetivo do refactor. Primeira, nenhum call site
manipula token:

```bash
grep -rn "decrypt(.*access_token" src/ --include=*.ts | grep -v providers/resolve.ts
```

Esperado: nenhuma saída.

Segunda, nenhum call site fora do adapter fala com `meta-api` para enviar:

```bash
grep -rln "sendTextMessage\|sendMediaMessage\|sendInteractiveButtons" src/ --include=*.ts \
  | grep -v "providers/meta.ts" | grep -v "meta-api" | grep -v ".test.ts"
```

Esperado: nenhuma saída.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(whatsapp): call sites de envio passam pelo adapter de provider"
```

---

### Task 6: Testes de caracterização do inbound da Meta

**Files:**
- Test: `src/app/api/whatsapp/webhook/route.characterization.test.ts`

**Interfaces:**
- Consumes: nada de tarefas anteriores
- Produces: rede de proteção para a Task 7 — nenhum símbolo exportado

Esta tarefa **não altera código de produção**. Ela existe porque a Task 7 é o
refactor de maior risco do plano: o caminho de entrada da Meta tem pouca
cobertura hoje, e uma regressão ali é silenciosa — mensagens simplesmente param
de chegar, sem erro visível.

- [ ] **Step 1: Escrever os testes que descrevem o comportamento ATUAL**

Criar `src/app/api/whatsapp/webhook/route.characterization.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { verifyMetaWebhookSignature } from "@/lib/whatsapp/webhook-signature";

/**
 * Testes de caracterização: travam o comportamento observável de hoje
 * para que a extração do núcleo de ingestão (Task 7) não possa
 * alterá-lo sem que a suíte perceba.
 *
 * Não julgam se o comportamento é bom — apenas o congelam.
 */

function signBody(body: string, secret: string): string {
  return "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");
}

describe("assinatura do webhook da Meta", () => {
  const secret = "test-meta-app-secret"; // igual ao vitest.config.ts

  it("aceita um corpo assinado com o app secret", () => {
    const body = JSON.stringify({ entry: [] });
    expect(verifyMetaWebhookSignature(body, signBody(body, secret))).toBe(true);
  });

  it("rejeita corpo adulterado após a assinatura", () => {
    const body = JSON.stringify({ entry: [] });
    const sig = signBody(body, secret);
    expect(verifyMetaWebhookSignature(body + " ", sig)).toBe(false);
  });

  it("rejeita assinatura ausente", () => {
    expect(verifyMetaWebhookSignature("{}", null)).toBe(false);
  });
});

describe("formato do payload de entrada da Meta", () => {
  // Congela a estrutura que o normalizador precisa continuar aceitando
  // depois da extração.
  const payload = {
    entry: [
      {
        id: "WABA_ID",
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: "5511999999999",
                phone_number_id: "PNID",
              },
              contacts: [{ profile: { name: "Maria" }, wa_id: "5511888888888" }],
              messages: [
                {
                  id: "wamid.ABC",
                  from: "5511888888888",
                  timestamp: "1700000000",
                  type: "text",
                  text: { body: "olá" },
                },
              ],
            },
          },
        ],
      },
    ],
  };

  it("localiza remetente, nome de perfil e texto nos caminhos esperados", () => {
    const value = payload.entry[0].changes[0].value;
    expect(value.metadata.phone_number_id).toBe("PNID");
    expect(value.contacts?.[0].profile.name).toBe("Maria");
    expect(value.messages?.[0].from).toBe("5511888888888");
    expect(value.messages?.[0].text?.body).toBe("olá");
    expect(value.messages?.[0].id).toBe("wamid.ABC");
  });
});
```

- [ ] **Step 2: Rodar e ver passar contra o código atual**

Run: `npx vitest run src/app/api/whatsapp/webhook/route.characterization.test.ts`
Expected: PASS — os testes descrevem o que já existe, então passam de primeira.
Se algum falhar, **pare**: significa que o comportamento atual não é o que o
teste supõe, e o teste é que precisa ser corrigido antes de seguir.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/whatsapp/webhook/route.characterization.test.ts
git commit -m "test(whatsapp): caracterização do inbound da Meta antes do refactor"
```

---

### Task 7: Extrair o núcleo de ingestão

**Files:**
- Create: `src/lib/whatsapp/inbound/ingest.ts`
- Modify: `src/app/api/whatsapp/webhook/route.ts:560-1113`
- Test: `src/lib/whatsapp/inbound/ingest.test.ts`

**Interfaces:**
- Consumes: `WhatsAppChannel` (Task 1)
- Produces: `ingestInboundMessage(db: SupabaseClient, params: IngestParams): Promise<IngestResult>` onde
  `IngestParams = { channel: WhatsAppChannel; from: string; pushName?: string; providerMessageId: string; timestamp: number; content: InboundContent; replyToProviderMessageId?: string }`,
  `InboundContent = { type: 'text' | 'image' | 'video' | 'document' | 'audio' | 'sticker' | 'location' | 'interactive'; text?: string; mediaUrl?: string; mediaType?: string; interactiveReplyId?: string }`,
  `IngestResult = { messageId: string; conversationId: string; contactId: string; deduped: boolean }`

- [ ] **Step 1: Escrever o teste que falha**

Criar `src/lib/whatsapp/inbound/ingest.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { InboundContent, IngestParams } from "./ingest";
import { buildConversationPreview, isDuplicateMessage } from "./ingest";

describe("buildConversationPreview", () => {
  it("usa o texto quando existe", () => {
    const content: InboundContent = { type: "text", text: "bom dia" };
    expect(buildConversationPreview(content)).toBe("bom dia");
  });

  it("usa um rótulo entre colchetes para mídia sem legenda", () => {
    const content: InboundContent = { type: "image" };
    expect(buildConversationPreview(content)).toBe("[image]");
  });

  it("prefere a legenda ao rótulo quando a mídia tem legenda", () => {
    const content: InboundContent = { type: "image", text: "olha isso" };
    expect(buildConversationPreview(content)).toBe("olha isso");
  });
});

describe("isDuplicateMessage", () => {
  it("reconhece a violação de unicidade do message_id como reentrega", () => {
    // Webhook é at-least-once. A reentrega precisa ser silenciosa,
    // não um 500 que faz o provedor tentar de novo em loop.
    expect(isDuplicateMessage({ code: "23505" })).toBe(true);
  });

  it("não confunde outros erros com duplicata", () => {
    expect(isDuplicateMessage({ code: "23503" })).toBe(false);
    expect(isDuplicateMessage(null)).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/lib/whatsapp/inbound/ingest.test.ts`
Expected: FAIL — `Failed to resolve import "./ingest"`

- [ ] **Step 3: Criar o módulo com os helpers puros**

Criar `src/lib/whatsapp/inbound/ingest.ts` começando pelas partes puras:

```ts
// ============================================================
// Núcleo de ingestão de mensagens recebidas — independente de
// provedor.
//
// As rotas de webhook (Meta e, na Parte B, UAZAPI) ficam finas:
// autenticam, traduzem o payload do provedor para `InboundContent`,
// e chamam `ingestInboundMessage`. Toda a lógica de negócio —
// achar/criar contato, achar/criar conversa, gravar a mensagem,
// disparar automations/flows/AI/webhooks — vive aqui.
// ============================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import type { WhatsAppChannel } from "@/types";

export interface InboundContent {
  type:
    | "text"
    | "image"
    | "video"
    | "document"
    | "audio"
    | "sticker"
    | "location"
    | "interactive";
  /** Corpo do texto, ou a legenda de uma mídia. */
  text?: string;
  mediaUrl?: string;
  mediaType?: string;
  /** Id do botão/linha tocado, quando o cliente responde a um interativo. */
  interactiveReplyId?: string;
}

export interface IngestParams {
  channel: WhatsAppChannel;
  /** Telefone do remetente, como o provedor entregou. */
  from: string;
  /** Nome do perfil no WhatsApp, quando o provedor informa. */
  pushName?: string;
  /** Id da mensagem no provedor — a chave de idempotência. */
  providerMessageId: string;
  /** Epoch em segundos. */
  timestamp: number;
  content: InboundContent;
  replyToProviderMessageId?: string;
}

export interface IngestResult {
  messageId: string;
  conversationId: string;
  contactId: string;
  /** true quando a mensagem já existia — reentrega do webhook. */
  deduped: boolean;
}

/** Texto mostrado na lista de conversas. */
export function buildConversationPreview(content: InboundContent): string {
  if (content.text) return content.text;
  return `[${content.type}]`;
}

/**
 * Postgres devolve 23505 em violação de índice único. Como
 * `messages.message_id` é único, isso identifica uma reentrega do
 * webhook — que precisa ser silenciosa, senão o provedor recebe 500 e
 * tenta de novo em loop.
 */
export function isDuplicateMessage(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  return (error as { code?: string }).code === "23505";
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/lib/whatsapp/inbound/ingest.test.ts`
Expected: PASS — 5 testes

- [ ] **Step 5: Mover a lógica de negócio do webhook para o ingest**

Recortar de `src/app/api/whatsapp/webhook/route.ts` as funções
`processMessage` (linha 560), `findOrCreateContact` (984) e
`findOrCreateConversation` (1044), e colá-las em `ingest.ts` compostas em
`ingestInboundMessage`. Três mudanças obrigatórias durante a mudança:

1. `findOrCreateConversation` passa a receber e filtrar por `channel.id` — é
   isso que faz dois números conviverem sem misturar conversas:

```ts
   const { data: existing } = await db
     .from("conversations")
     .select("*")
     .eq("account_id", channel.account_id)
     .eq("contact_id", contactId)
     .eq("channel_id", channel.id)
     .maybeSingle();
```

   E o insert grava `channel_id: channel.id`.

2. `accountId` vem de `channel.account_id`, não mais de uma busca por
   `phone_number_id`.

3. A resolução de URL de mídia sai daqui: a rota já entrega `content.mediaUrl`
   pronto. É o que permite Meta (proxy) e UAZAPI (Storage) divergirem sem que o
   ingest saiba.

O que **não** muda: os disparos para `runAutomationsForTrigger`,
`dispatchInboundToFlows`, `dispatchInboundToAiReply` e `dispatchWebhookEvent`
seguem idênticos, na mesma ordem.

Em `route.ts`, `processWebhook` passa a: verificar HMAC → localizar o canal por
`phone_number_id` → traduzir o payload → chamar `ingestInboundMessage`.

- [ ] **Step 6: Verificar que nada mudou**

```bash
npm test && npm run typecheck && npm run lint
```

Esperado: suíte verde, **incluindo os testes de caracterização da Task 6**. Eles
são a evidência de que o refactor preservou o comportamento.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(whatsapp): extrai núcleo de ingestão para uso por múltiplos provedores"
```

---

### Task 8: API de canais e UI sem leitura direta da tabela

**Files:**
- Create: `src/app/api/whatsapp/channels/route.ts`
- Modify: `src/components/settings/whatsapp-config.tsx`
- Modify: `src/components/settings/settings-overview.tsx`
- Test: `src/app/api/whatsapp/channels/route.test.ts`

**Interfaces:**
- Consumes: `getCurrentAccount` de `@/lib/auth/account`; `WhatsAppChannel` (Task 1)
- Produces: `GET /api/whatsapp/channels` → `{ channels: PublicChannel[] }` onde
  `PublicChannel = { id, provider, label, phone_e164, status, connected_at, last_error }`;
  função exportada `toPublicChannel(row: WhatsAppChannel): PublicChannel`

- [ ] **Step 1: Escrever o teste que falha**

Criar `src/app/api/whatsapp/channels/route.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { toPublicChannel } from "./route";

const rowCompleta = {
  id: "chan-1",
  account_id: "acc-1",
  provider: "uazapi" as const,
  label: "Recepção",
  phone_e164: "5511999999999",
  status: "connected" as const,
  connected_at: "2026-07-27T12:00:00Z",
  last_error: undefined,
  access_token: "ciphertext-meta",
  verify_token: "ciphertext-verify",
  uazapi_token: "ciphertext-uazapi",
  uazapi_base_url: "https://x.uazapi.com",
  webhook_secret: "segredo-do-webhook",
};

describe("toPublicChannel", () => {
  it("expõe os campos que a UI precisa", () => {
    expect(toPublicChannel(rowCompleta)).toEqual({
      id: "chan-1",
      provider: "uazapi",
      label: "Recepção",
      phone_e164: "5511999999999",
      status: "connected",
      connected_at: "2026-07-27T12:00:00Z",
      last_error: undefined,
    });
  });

  it("não vaza nenhum campo sensível", () => {
    // Antes desta mudança a UI lia a tabela direto do browser e
    // recebia as colunas de token — criptografadas, mas ainda assim.
    // Com N canais isso multiplicaria.
    const serialized = JSON.stringify(toPublicChannel(rowCompleta));
    expect(serialized).not.toContain("ciphertext");
    expect(serialized).not.toContain("segredo-do-webhook");
    expect(serialized).not.toContain("uazapi.com");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/app/api/whatsapp/channels/route.test.ts`
Expected: FAIL — `Failed to resolve import "./route"`

- [ ] **Step 3: Escrever a rota**

Criar `src/app/api/whatsapp/channels/route.ts`:

```ts
import { NextResponse } from "next/server";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import type { WhatsAppChannel, WhatsAppProviderKind } from "@/types";

/**
 * A projeção que o cliente pode ver. Tudo que não estiver listado aqui
 * — em especial as colunas de token e o webhook_secret — nunca sai do
 * servidor.
 */
export interface PublicChannel {
  id: string;
  provider: WhatsAppProviderKind;
  label?: string;
  phone_e164?: string;
  status: WhatsAppChannel["status"];
  connected_at?: string;
  last_error?: string;
}

export function toPublicChannel(row: WhatsAppChannel): PublicChannel {
  return {
    id: row.id,
    provider: row.provider,
    label: row.label,
    phone_e164: row.phone_e164,
    status: row.status,
    connected_at: row.connected_at,
    last_error: row.last_error,
  };
}

export async function GET() {
  try {
    const { supabase, accountId } = await getCurrentAccount();

    const { data, error } = await supabase
      .from("whatsapp_channels")
      .select(
        "id, account_id, provider, label, phone_e164, status, connected_at, last_error",
      )
      .eq("account_id", accountId)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("[channels] falha ao listar:", error.message);
      return NextResponse.json(
        { error: "Falha ao carregar os canais." },
        { status: 500 },
      );
    }

    return NextResponse.json({
      channels: (data ?? []).map((row) => toPublicChannel(row as WhatsAppChannel)),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
```

`AccountContext` (definido em `src/lib/auth/account.ts:81-92`) expõe
`{ supabase, userId, accountId, role, account }` — os dois campos usados acima
existem. `toErrorResponse` já mapeia `UnauthorizedError` para 401 e
`ForbiddenError` para 403.

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/app/api/whatsapp/channels/route.test.ts`
Expected: PASS — 2 testes

- [ ] **Step 5: Trocar a leitura direta na UI**

Em `src/components/settings/whatsapp-config.tsx` e
`src/components/settings/settings-overview.tsx`, substituir as consultas
`supabase.from('whatsapp_channels').select(...)` feitas no cliente por:

```ts
const res = await fetch("/api/whatsapp/channels");
const { channels } = await res.json();
```

Localizar todas as ocorrências:

```bash
grep -rn "from('whatsapp_channels')" src/components/
```

Esperado após a mudança: nenhuma saída.

- [ ] **Step 6: Verificar**

```bash
npm test && npm run typecheck && npm run lint
```

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(whatsapp): API de canais e remoção da leitura direta da tabela no cliente"
```

---

## Verificação final da Parte A

Ao fim das 8 tarefas, confirmar:

```bash
npm test && npm run typecheck && npm run lint && npm run build
```

E, manualmente, num ambiente com número Meta conectado:

1. Enviar uma mensagem pelo inbox → chega no WhatsApp.
2. Responder pelo WhatsApp → aparece no inbox.
3. Disparar um broadcast pequeno → entregue.
4. Uma automação com envio → dispara.

Nenhum desses passos deve se comportar diferente de antes. Este plano não
adiciona funcionalidade — ele muda a arquitetura por baixo dela.

## O que fica para a Parte B

Cliente HTTP da UAZAPI, provider UAZAPI, rotas de canais (criar / conectar /
status / remover), fluxo de QR Code, rota de webhook de entrada, UI de canais e
seletores, e o tratamento do erro 463 nos broadcasts.

A Parte B depende de quatro páginas de documentação da UAZAPI ainda não obtidas
(ver §11 da spec): path do "Configurar Webhook da Instância", schema
`WebhookEvent`, "Enviar menu interativo" e "Enviar reação a uma mensagem". Sem o
`WebhookEvent` em especial, o normalizador do inbound não pode ser escrito sem
placeholders.

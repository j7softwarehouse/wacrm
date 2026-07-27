# Canal UAZAPI — Plano de Implementação (Parte B)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Conectar um número de WhatsApp por QR Code via UAZAPI e operar o CRM inteiro por ele — receber no inbox, responder, disparar broadcasts, rodar flows e automações.

**Architecture:** Um cliente HTTP fino para a UAZAPI, um `WhatsAppProvider` que o embrulha (encaixando na interface criada na Parte A), rotas de canal para cadastrar/conectar/monitorar, e uma rota de webhook roteada por segredo por canal que normaliza o evento e chama o `ingestInboundMessage` compartilhado.

**Tech Stack:** Next.js 16 (App Router), TypeScript, Supabase, Vitest.

**Depende de:** [Parte A](2026-07-27-multicanal-fundacao.md) concluída. Sem a tabela `whatsapp_channels`, o `channel_id` nas conversas, o `WhatsAppProvider` e o `ingestInboundMessage`, nenhuma tarefa aqui compila.

**Spec:** [`docs/superpowers/specs/2026-07-27-uazapi-multicanal-design.md`](../specs/2026-07-27-uazapi-multicanal-design.md)

## Global Constraints

- **Base URL e token vêm sempre do canal**, nunca de env. Não existe `UAZAPI_*` no `.env`.
- **O token da instância nunca chega ao browser.** Toda chamada à UAZAPI é server-side.
- **O QR Code nunca é persistido.** É credencial de sessão do WhatsApp; trafega só na resposta HTTP.
- **`excludeMessages` sempre inclui `wasSentByApi`.** Sem ele, cada mensagem que o CRM envia volta como evento e é inserida de novo. A doc da UAZAPI recomenda explicitamente.
- **`addUrlEvents` e `addUrlTypesMessages` sempre `false`.** Quando ativos, a UAZAPI acrescenta segmentos ao caminho da URL — e o segredo de roteamento vive no caminho.
- Verificação antes de cada commit: `npm test && npm run typecheck && npm run lint`.
- Branch: `feat/uazapi-multicanal`.

## Escopo da UI nesta entrega

**Incluído:** tela de canais (listar, adicionar, conectar por QR, remover), indicador de canal no inbox, aviso de canal desconectado.

**Cortado de propósito** — o schema suporta, a UI não expõe ainda:

| Cortado | Comportamento padrão na v1 |
|---|---|
| Seletor de canal em broadcasts | Usa o canal conectado mais antigo da conta |
| Seletor "de qual número enviar" ao iniciar conversa | Idem |
| Gestão de templates por canal Meta | Continua presa ao canal Meta mais antigo (spec §2) |

São telas, não estrutura. Adicionar depois não exige migração.

---

## Estrutura de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `src/lib/whatsapp/uazapi/client.ts` | HTTP puro: monta URL, injeta header `token`, traduz erro |
| `src/lib/whatsapp/uazapi/errors.ts` | Reconhece o 463 e demais erros estruturados |
| `src/lib/whatsapp/providers/uazapi.ts` | Implementa `WhatsAppProvider` sobre o client |
| `src/lib/whatsapp/uazapi/normalize.ts` | `WebhookEvent` → `InboundContent` |
| `src/lib/storage/store-inbound-media.ts` | Baixa mídia recebida para o bucket, server-side |
| `src/app/api/whatsapp/channels/route.ts` | `POST` cadastrar (o `GET` veio na Parte A) |
| `src/app/api/whatsapp/channels/[id]/route.ts` | `DELETE` remover |
| `src/app/api/whatsapp/channels/[id]/connect/route.ts` | `POST` iniciar conexão, devolve QR |
| `src/app/api/whatsapp/channels/[id]/status/route.ts` | `GET` proxy de status + QR renovado |
| `src/app/api/whatsapp/uazapi/webhook/[...secret]/route.ts` | Entrada de eventos |
| `src/components/settings/channels-manager.tsx` | Lista, formulário e modal do QR |

---

### Task 1: Cliente HTTP da UAZAPI

**Files:**
- Create: `src/lib/whatsapp/uazapi/client.ts`
- Create: `src/lib/whatsapp/uazapi/errors.ts`
- Test: `src/lib/whatsapp/uazapi/client.test.ts`

**Interfaces:**
- Consumes: `ProviderRateLimitError`, `ProviderError` de `@/lib/whatsapp/providers/types` (Parte A, Task 2)
- Produces: `createUazapiClient(config: UazapiConfig): UazapiClient` onde
  `UazapiConfig = { baseUrl: string; token: string }` e
  `UazapiClient = { post<T>(path: string, body: unknown): Promise<T>; get<T>(path: string): Promise<T> }`;
  `normalizeBaseUrl(input: string): string`;
  `parseUazapiError(status: number, body: unknown): Error`

- [ ] **Step 1: Escrever o teste que falha**

Criar `src/lib/whatsapp/uazapi/client.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ProviderRateLimitError } from "@/lib/whatsapp/providers/types";
import { normalizeBaseUrl, parseUazapiError } from "./client";

describe("normalizeBaseUrl", () => {
  it("aceita o subdomínio puro e monta a URL completa", () => {
    expect(normalizeBaseUrl("minhaempresa")).toBe("https://minhaempresa.uazapi.com");
  });

  it("aceita a URL completa e a mantém", () => {
    expect(normalizeBaseUrl("https://minhaempresa.uazapi.com")).toBe(
      "https://minhaempresa.uazapi.com",
    );
  });

  it("remove a barra final — senão as URLs saem com barra dupla", () => {
    expect(normalizeBaseUrl("https://x.uazapi.com/")).toBe("https://x.uazapi.com");
  });

  it("força https: o token trafega no header e não pode ir em claro", () => {
    expect(normalizeBaseUrl("http://x.uazapi.com")).toBe("https://x.uazapi.com");
  });

  it("rejeita entrada vazia", () => {
    expect(() => normalizeBaseUrl("")).toThrow();
  });
});

describe("parseUazapiError", () => {
  it("reconhece o 463 do WhatsApp como limite de envio", () => {
    // A conta está temporariamente impedida de iniciar novas conversas.
    // Um broadcast que receba isso precisa PARAR — repetir queima a
    // reputação do número e escala para banimento.
    const body = {
      error: "WhatsApp server error 463: ...",
      error_source: "whatsapp_server",
      provider_code: 463,
      error_key: "WHATSAPP_REACHOUT_TIMELOCK",
      message_ptbr: "O servidor do WhatsApp recusou esta mensagem.",
      provider_message_ptbr:
        "O WhatsApp informou que a conta está sob restrição temporária.",
    };
    const err = parseUazapiError(500, body);
    expect(err).toBeInstanceOf(ProviderRateLimitError);
    const rate = err as ProviderRateLimitError;
    expect(rate.providerCode).toBe(463);
    expect(rate.errorKey).toBe("WHATSAPP_REACHOUT_TIMELOCK");
  });

  it("prefere a mensagem em português — este deployment roda em pt", () => {
    const err = parseUazapiError(500, {
      provider_code: 463,
      provider_message: "temporary restriction",
      provider_message_ptbr: "restrição temporária",
    }) as ProviderRateLimitError;
    expect(err.providerMessage).toBe("restrição temporária");
  });

  it("trata 401 como erro comum, não como limite", () => {
    const err = parseUazapiError(401, { error: "Invalid token" });
    expect(err).not.toBeInstanceOf(ProviderRateLimitError);
    expect(err.message).toContain("Invalid token");
  });

  it("não quebra com corpo inesperado", () => {
    const err = parseUazapiError(500, "erro em texto puro");
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBeTruthy();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/lib/whatsapp/uazapi/client.test.ts`
Expected: FAIL — `Failed to resolve import "./client"`

- [ ] **Step 3: Escrever o tradutor de erros**

Criar `src/lib/whatsapp/uazapi/errors.ts`:

```ts
// ============================================================
// Tradução dos erros da UAZAPI para os tipos do CRM.
//
// A UAZAPI distingue erro dela de erro do WhatsApp através de
// `error_source: "whatsapp_server"`. Essa distinção importa: um erro
// dela pode ser repetido; um erro do WhatsApp (463) não pode.
// ============================================================

import {
  ProviderError,
  ProviderRateLimitError,
} from "@/lib/whatsapp/providers/types";

/** Códigos do WhatsApp que significam "pare de enviar". */
const WHATSAPP_THROTTLE_CODES = new Set([463]);

interface UazapiErrorBody {
  error?: string;
  error_source?: string;
  provider_code?: number;
  error_key?: string;
  message?: string;
  message_ptbr?: string;
  provider_message?: string;
  provider_message_ptbr?: string;
}

function asBody(body: unknown): UazapiErrorBody {
  if (body && typeof body === "object") return body as UazapiErrorBody;
  return {};
}

export function parseUazapiError(status: number, body: unknown): Error {
  const b = asBody(body);

  // pt-BR primeiro: a API já devolve localizado e este deployment roda
  // em pt, então não há tradução nossa para manter sincronizada.
  const providerMessage = b.provider_message_ptbr ?? b.provider_message;

  if (b.provider_code && WHATSAPP_THROTTLE_CODES.has(b.provider_code)) {
    return new ProviderRateLimitError("uazapi", {
      errorKey: b.error_key,
      providerCode: b.provider_code,
      providerMessage,
    });
  }

  const message =
    b.message_ptbr ??
    b.error ??
    b.message ??
    (typeof body === "string" && body ? body : `Erro HTTP ${status} da UAZAPI.`);

  return new ProviderError("uazapi", message);
}
```

- [ ] **Step 4: Escrever o cliente**

Criar `src/lib/whatsapp/uazapi/client.ts`:

```ts
// ============================================================
// Cliente HTTP da UAZAPI.
//
// Fino de propósito: monta a URL, injeta o header `token`, e traduz
// respostas não-2xx. Toda a semântica de mensagem vive no provider.
// ============================================================

import { parseUazapiError } from "./errors";

export { parseUazapiError };

export interface UazapiConfig {
  /** Subdomínio ou URL completa. Normalizado por `normalizeBaseUrl`. */
  baseUrl: string;
  /** Token da instância. */
  token: string;
}

export interface UazapiClient {
  post<T>(path: string, body: unknown): Promise<T>;
  get<T>(path: string): Promise<T>;
}

/**
 * Aceita `"minhaempresa"` ou `"https://minhaempresa.uazapi.com"` e
 * devolve sempre a forma canônica, sem barra final.
 *
 * Força https porque o token da instância viaja no header — em http
 * ele iria em claro.
 */
export function normalizeBaseUrl(input: string): string {
  const trimmed = (input ?? "").trim();
  if (!trimmed) {
    throw new Error("O subdomínio ou a URL da UAZAPI é obrigatório.");
  }

  const withScheme = /^https?:\/\//i.test(trimmed)
    ? trimmed.replace(/^http:\/\//i, "https://")
    : `https://${trimmed}.uazapi.com`;

  return withScheme.replace(/\/+$/, "");
}

/** Timeout por requisição. A UAZAPI pode demorar em envio de mídia. */
const REQUEST_TIMEOUT_MS = 30_000;

export function createUazapiClient(config: UazapiConfig): UazapiClient {
  const baseUrl = normalizeBaseUrl(config.baseUrl);
  const { token } = config;

  const request = async <T>(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
  ): Promise<T> => {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        token,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    const text = await response.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      // Mantém o texto cru — `parseUazapiError` lida com isso.
    }

    if (!response.ok) {
      throw parseUazapiError(response.status, parsed);
    }
    return parsed as T;
  };

  return {
    post: <T>(path: string, body: unknown) => request<T>("POST", path, body),
    get: <T>(path: string) => request<T>("GET", path),
  };
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run src/lib/whatsapp/uazapi/client.test.ts`
Expected: PASS — 9 testes

- [ ] **Step 6: Commit**

```bash
git add src/lib/whatsapp/uazapi/
git commit -m "feat(uazapi): cliente HTTP e tradução de erros do provedor"
```

---

### Task 2: Provider UAZAPI

**Files:**
- Create: `src/lib/whatsapp/providers/uazapi.ts`
- Modify: `src/lib/whatsapp/providers/resolve.ts`
- Test: `src/lib/whatsapp/providers/uazapi.test.ts`

**Interfaces:**
- Consumes: `createUazapiClient` (Task 1); `WhatsAppProvider`, `ProviderUnsupportedError` (Parte A)
- Produces: `createUazapiProvider(config: UazapiProviderConfig): WhatsAppProvider` onde `UazapiProviderConfig = { baseUrl: string; token: string; accountId: string }`

- [ ] **Step 1: Escrever o teste que falha**

Criar `src/lib/whatsapp/providers/uazapi.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderUnsupportedError } from "./types";
import { createUazapiProvider } from "./uazapi";

const post = vi.fn(async () => ({ messageid: "MSG123" }));

vi.mock("@/lib/whatsapp/uazapi/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/whatsapp/uazapi/client")>();
  return { ...actual, createUazapiClient: () => ({ post, get: vi.fn() }) };
});

const config = {
  baseUrl: "https://x.uazapi.com",
  token: "TOKEN",
  accountId: "acc-1",
};

describe("createUazapiProvider", () => {
  beforeEach(() => vi.clearAllMocks());

  it("se identifica como uazapi", () => {
    expect(createUazapiProvider(config).kind).toBe("uazapi");
  });

  it("envia texto em /send/text e lê o messageid da resposta", async () => {
    const provider = createUazapiProvider(config);
    const result = await provider.sendText({ to: "5511999999999", text: "oi" });

    expect(post).toHaveBeenCalledWith("/send/text", {
      number: "5511999999999",
      text: "oi",
    });
    // A UAZAPI chama de `messageid`; o CRM chama de `messageId`.
    expect(result).toEqual({ messageId: "MSG123" });
  });

  it("mapeia contextMessageId para replyid", async () => {
    const provider = createUazapiProvider(config);
    await provider.sendText({ to: "55119", text: "oi", contextMessageId: "ABC" });
    expect(post).toHaveBeenCalledWith("/send/text", {
      number: "55119",
      text: "oi",
      replyid: "ABC",
    });
  });

  it("envia mídia com type, file e caption em text", async () => {
    // Na UAZAPI a legenda vai no campo `text`, não em `caption`.
    const provider = createUazapiProvider(config);
    await provider.sendMedia({
      to: "55119",
      kind: "document",
      link: "https://exemplo.com/a.pdf",
      caption: "segue",
      filename: "Contrato.pdf",
    });
    expect(post).toHaveBeenCalledWith("/send/media", {
      number: "55119",
      type: "document",
      file: "https://exemplo.com/a.pdf",
      text: "segue",
      docName: "Contrato.pdf",
    });
  });

  it("envia botões como menu type=button", async () => {
    const provider = createUazapiProvider(config);
    await provider.sendInteractiveButtons({
      to: "55119",
      bodyText: "Escolha:",
      footerText: "rodapé",
      buttons: [
        { id: "sim", title: "Sim" },
        { id: "nao", title: "Não" },
      ],
    });
    expect(post).toHaveBeenCalledWith("/send/menu", {
      number: "55119",
      type: "button",
      text: "Escolha:",
      footerText: "rodapé",
      choices: ["Sim", "Não"],
    });
  });

  it("envia reação com o emoji no campo text", async () => {
    // Nomenclatura contra-intuitiva da UAZAPI: `text` é o emoji e
    // `id` é a mensagem-alvo.
    const provider = createUazapiProvider(config);
    await provider.sendReaction({
      to: "55119",
      targetMessageId: "MSG_ALVO",
      emoji: "👍",
    });
    expect(post).toHaveBeenCalledWith("/message/react", {
      number: "55119",
      id: "MSG_ALVO",
      text: "👍",
    });
  });

  it("recusa template — não existe na UAZAPI", async () => {
    const provider = createUazapiProvider(config);
    await expect(
      provider.sendTemplate({ to: "55119", templateName: "x", language: "pt_BR" }),
    ).rejects.toBeInstanceOf(ProviderUnsupportedError);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/lib/whatsapp/providers/uazapi.test.ts`
Expected: FAIL — `Failed to resolve import "./uazapi"`

- [ ] **Step 3: Escrever o provider**

Criar `src/lib/whatsapp/providers/uazapi.ts`:

```ts
// ============================================================
// Provider UAZAPI.
//
// Traduz a interface do CRM para os endpoints da UAZAPI. Duas
// diferenças de vocabulário merecem atenção porque não são
// adivinháveis:
//   - a legenda de mídia vai em `text`, não em `caption`
//   - em /message/react o emoji vai em `text` e o alvo em `id`
// ============================================================

import { createUazapiClient } from "@/lib/whatsapp/uazapi/client";
import { uploadAccountMedia } from "@/lib/storage/upload-media";

import {
  ProviderUnsupportedError,
  type SendInteractiveButtonsArgs,
  type SendInteractiveListArgs,
  type SendMediaArgs,
  type SendReactionArgs,
  type SendResult,
  type SendTextArgs,
  type WhatsAppProvider,
} from "./types";

export interface UazapiProviderConfig {
  baseUrl: string;
  token: string;
  /** Necessário para gravar mídia recebida no bucket certo. */
  accountId: string;
}

/** A UAZAPI devolve `messageid`; o CRM usa `messageId`. */
interface UazapiSendResponse {
  messageid?: string;
  id?: string;
}

function toSendResult(response: UazapiSendResponse): SendResult {
  return { messageId: response.messageid ?? response.id ?? "" };
}

export function createUazapiProvider(
  config: UazapiProviderConfig,
): WhatsAppProvider {
  const client = createUazapiClient({
    baseUrl: config.baseUrl,
    token: config.token,
  });

  return {
    kind: "uazapi",

    async sendText(args: SendTextArgs): Promise<SendResult> {
      const body: Record<string, unknown> = { number: args.to, text: args.text };
      if (args.contextMessageId) body.replyid = args.contextMessageId;
      return toSendResult(await client.post<UazapiSendResponse>("/send/text", body));
    },

    async sendMedia(args: SendMediaArgs): Promise<SendResult> {
      const body: Record<string, unknown> = {
        number: args.to,
        type: args.kind,
        file: args.link,
      };
      if (args.caption) body.text = args.caption;
      if (args.filename) body.docName = args.filename;
      if (args.contextMessageId) body.replyid = args.contextMessageId;
      return toSendResult(await client.post<UazapiSendResponse>("/send/media", body));
    },

    async sendInteractiveButtons(
      args: SendInteractiveButtonsArgs,
    ): Promise<SendResult> {
      // /send/menu recebe `choices` como títulos. O id estável dos
      // botões do CRM não tem equivalente: a resposta do cliente volta
      // em `buttonOrListid` com o título tocado, e é isso que a
      // normalização usa para casar com o botão.
      const body: Record<string, unknown> = {
        number: args.to,
        type: "button",
        text: args.bodyText,
        choices: args.buttons.map((b) => b.title),
      };
      if (args.footerText) body.footerText = args.footerText;
      if (args.contextMessageId) body.replyid = args.contextMessageId;
      return toSendResult(await client.post<UazapiSendResponse>("/send/menu", body));
    },

    async sendInteractiveList(args: SendInteractiveListArgs): Promise<SendResult> {
      const choices = args.sections.flatMap((section) =>
        section.rows.map((row) => row.title),
      );
      const body: Record<string, unknown> = {
        number: args.to,
        type: "list",
        text: args.bodyText,
        listButton: args.buttonLabel,
        choices,
      };
      if (args.footerText) body.footerText = args.footerText;
      if (args.contextMessageId) body.replyid = args.contextMessageId;
      return toSendResult(await client.post<UazapiSendResponse>("/send/menu", body));
    },

    async sendReaction(args: SendReactionArgs): Promise<SendResult> {
      return toSendResult(
        await client.post<UazapiSendResponse>("/message/react", {
          number: args.to,
          id: args.targetMessageId,
          text: args.emoji,
        }),
      );
    },

    async sendTemplate(): Promise<SendResult> {
      // Templates aprovados são um conceito exclusivo da Meta. A UI
      // esconde a funcionalidade em canais UAZAPI; isto é a rede de
      // proteção para um caminho que não deveria ser alcançável.
      throw new ProviderUnsupportedError("uazapi", "sendTemplate");
    },

    async resolveInboundMediaUrl(ref: string): Promise<string | null> {
      // A UAZAPI entrega `fileURL` pronto, mas URLs de mídia do
      // WhatsApp expiram — guardar o link cru deixaria o histórico
      // quebrado em poucas horas. Baixa uma vez e guarda no Storage.
      if (!ref) return null;
      return storeInboundMedia(config.accountId, ref);
    },
  };
}
```

Import correspondente no topo:

```ts
import { storeInboundMedia } from "@/lib/storage/store-inbound-media";
```

- [ ] **Step 3b: Escrever o upload server-side**

`uploadAccountMedia` **não serve aqui**: sua assinatura é
`uploadAccountMedia(bucket: string, file: File)` e ela roda no cliente —
chama `supabase.auth.getUser()` e resolve o `account_id` a partir da
sessão do navegador. Uma rota de webhook não tem sessão nenhuma.

Criar `src/lib/storage/store-inbound-media.ts`:

```ts
// ============================================================
// Baixa uma mídia recebida e a guarda no bucket `chat-media`.
//
// Existe separado de `upload-media.ts` porque aquele módulo roda no
// cliente (resolve a conta pela sessão do navegador). Aqui não há
// sessão: o chamador é o webhook, então usamos o service-role e
// recebemos o `accountId` explicitamente.
// ============================================================

import { createClient } from "@supabase/supabase-js";

import { buildMediaPath } from "./upload-media";

const BUCKET = "chat-media";

/** Teto de segurança: mídia recebida não pode encher o bucket. */
const MAX_INBOUND_BYTES = 16 * 1024 * 1024;

export async function storeInboundMedia(
  accountId: string,
  sourceUrl: string,
): Promise<string | null> {
  try {
    const response = await fetch(sourceUrl, {
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) return null;

    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_INBOUND_BYTES) {
      console.warn(
        `[store-inbound-media] tamanho fora do aceitável: ${bytes.byteLength} bytes`,
      );
      return null;
    }

    const contentType =
      response.headers.get("content-type") ?? "application/octet-stream";

    // `buildMediaPath` já produz o caminho `account-<id>/…` que as
    // políticas RLS do bucket esperam (migração 023).
    const filename = new URL(sourceUrl).pathname.split("/").pop() || "media";
    const path = buildMediaPath(accountId, filename);

    const admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );

    const { error } = await admin.storage
      .from(BUCKET)
      .upload(path, bytes, { contentType, upsert: false, cacheControl: "3600" });
    if (error) {
      console.error("[store-inbound-media] upload falhou:", error.message);
      return null;
    }

    const {
      data: { publicUrl },
    } = admin.storage.from(BUCKET).getPublicUrl(path);
    return publicUrl;
  } catch (err) {
    console.error(
      "[store-inbound-media] erro ao baixar mídia:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}
```

Confirmar que `buildMediaPath` está exportado — está, em
`src/lib/storage/upload-media.ts:46`.

- [ ] **Step 4: Registrar no resolver**

Em `src/lib/whatsapp/providers/resolve.ts`, na função `buildProvider`,
substituir o `throw new ProviderUnsupportedError(...)` do ramo UAZAPI por:

```ts
  if (channel.provider === "uazapi") {
    return createUazapiProvider({
      baseUrl: channel.uazapi_base_url!,
      token: decrypt(channel.uazapi_token!),
      accountId: channel.account_id,
    });
  }
```

E acrescentar o import:

```ts
import { createUazapiProvider } from "./uazapi";
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npx vitest run src/lib/whatsapp/providers/`
Expected: PASS — testes de `types`, `meta`, `resolve` e `uazapi`

- [ ] **Step 6: Commit**

```bash
git add src/lib/whatsapp/providers/
git commit -m "feat(uazapi): provider de envio e registro no resolver"
```

---

### Task 3: Cadastrar e remover canal

**Files:**
- Modify: `src/app/api/whatsapp/channels/route.ts` (acrescenta `POST`)
- Create: `src/app/api/whatsapp/channels/[id]/route.ts`
- Test: `src/app/api/whatsapp/channels/route.post.test.ts`

**Interfaces:**
- Consumes: `createUazapiClient`, `normalizeBaseUrl` (Task 1); `toPublicChannel`, `getCurrentAccount` (Parte A, Task 8); `encrypt` de `@/lib/whatsapp/encryption`
- Produces: `POST /api/whatsapp/channels` → `{ channel: PublicChannel }`; `DELETE /api/whatsapp/channels/[id]` → `{ ok: true }`; função exportada `generateWebhookSecret(): string`

- [ ] **Step 1: Escrever o teste que falha**

Criar `src/app/api/whatsapp/channels/route.post.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { generateWebhookSecret } from "./route";

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
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/app/api/whatsapp/channels/route.post.test.ts`
Expected: FAIL — `generateWebhookSecret is not exported`

- [ ] **Step 3: Acrescentar o POST**

Em `src/app/api/whatsapp/channels/route.ts`, acrescentar:

```ts
import crypto from "node:crypto";

import { createUazapiClient, normalizeBaseUrl } from "@/lib/whatsapp/uazapi/client";
import { encrypt } from "@/lib/whatsapp/encryption";

/** 32 bytes aleatórios em hex. É a chave de roteamento do inbound. */
export function generateWebhookSecret(): string {
  return crypto.randomBytes(32).toString("hex");
}

interface CreateChannelBody {
  provider: "uazapi";
  label?: string;
  baseUrl: string;
  token: string;
}

export async function POST(request: Request) {
  try {
    const { supabase, accountId } = await getCurrentAccount();
    const body = (await request.json()) as CreateChannelBody;

    if (body.provider !== "uazapi") {
      return NextResponse.json(
        { error: "Apenas canais UAZAPI podem ser criados por aqui." },
        { status: 400 },
      );
    }
    if (!body.baseUrl || !body.token) {
      return NextResponse.json(
        { error: "Informe o subdomínio e o token da instância." },
        { status: 400 },
      );
    }

    let baseUrl: string;
    try {
      baseUrl = normalizeBaseUrl(body.baseUrl);
    } catch {
      return NextResponse.json(
        { error: "Subdomínio ou URL da UAZAPI inválido." },
        { status: 400 },
      );
    }

    // Valida a credencial ANTES de gravar. Credencial errada falha
    // aqui, com mensagem clara, e não deixa linha morta no banco.
    let instanceId: string | undefined;
    try {
      const client = createUazapiClient({ baseUrl, token: body.token });
      const status = await client.get<{ instance?: { id?: string } }>(
        "/instance/status",
      );
      instanceId = status.instance?.id;
    } catch (err) {
      return NextResponse.json(
        {
          error:
            "Não foi possível falar com a instância UAZAPI. Confira o subdomínio e o token. " +
            (err instanceof Error ? err.message : ""),
        },
        { status: 400 },
      );
    }

    const { data, error } = await supabase
      .from("whatsapp_channels")
      .insert({
        account_id: accountId,
        provider: "uazapi",
        label: body.label ?? null,
        uazapi_base_url: baseUrl,
        uazapi_token: encrypt(body.token),
        uazapi_instance_id: instanceId ?? null,
        webhook_secret: generateWebhookSecret(),
        status: "disconnected",
      })
      .select()
      .single();

    if (error) {
      // 23505 = violação de índice único. Aqui só pode ser a instância
      // já reivindicada por outra conta.
      if ((error as { code?: string }).code === "23505") {
        return NextResponse.json(
          { error: "Esta instância UAZAPI já está vinculada a outra conta." },
          { status: 409 },
        );
      }
      console.error("[channels] falha ao criar:", error.message);
      return NextResponse.json(
        { error: "Não foi possível salvar o canal." },
        { status: 500 },
      );
    }

    return NextResponse.json({ channel: toPublicChannel(data as WhatsAppChannel) });
  } catch (err) {
    return toErrorResponse(err);
  }
}
```

- [ ] **Step 4: Escrever o DELETE**

Criar `src/app/api/whatsapp/channels/[id]/route.ts`:

```ts
import { NextResponse } from "next/server";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";

/**
 * Remove um canal. As conversas dele **não** são apagadas: a FK usa
 * ON DELETE SET NULL, então elas ficam como histórico somente-leitura.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { supabase, accountId } = await getCurrentAccount();
    const { id } = await params;

    const { error } = await supabase
      .from("whatsapp_channels")
      .delete()
      .eq("id", id)
      .eq("account_id", accountId);

    if (error) {
      console.error("[channels] falha ao remover:", error.message);
      return NextResponse.json(
        { error: "Não foi possível remover o canal." },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
```

O `params` é `Promise` — confira a convenção do App Router em uso lendo
outra rota dinâmica existente, por exemplo
`src/app/api/whatsapp/templates/[id]/route.ts`, e siga a mesma forma.

- [ ] **Step 5: Rodar e verificar**

```bash
npx vitest run src/app/api/whatsapp/channels/
npm run typecheck
```

Expected: PASS — 2 testes; sem erros de tipo.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/whatsapp/channels/
git commit -m "feat(uazapi): cadastro e remoção de canal com validação de credencial"
```

---

### Task 4: Conectar por QR Code

**Files:**
- Create: `src/app/api/whatsapp/channels/[id]/connect/route.ts`
- Create: `src/app/api/whatsapp/channels/[id]/status/route.ts`
- Create: `src/lib/whatsapp/uazapi/connection.ts`
- Test: `src/lib/whatsapp/uazapi/connection.test.ts`

**Interfaces:**
- Consumes: `createUazapiClient` (Task 1)
- Produces: `mapInstanceStatus(raw: string | undefined): ChannelStatus` onde `ChannelStatus = 'connected' | 'connecting' | 'disconnected' | 'hibernated'`; `phoneFromJid(jid: string | null | undefined): string | null`; `buildWebhookConfig(url: string): UazapiWebhookConfig`

- [ ] **Step 1: Escrever o teste que falha**

Criar `src/lib/whatsapp/uazapi/connection.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildWebhookConfig, mapInstanceStatus, phoneFromJid } from "./connection";

describe("mapInstanceStatus", () => {
  it("mapeia os quatro estados documentados", () => {
    expect(mapInstanceStatus("connected")).toBe("connected");
    expect(mapInstanceStatus("connecting")).toBe("connecting");
    expect(mapInstanceStatus("disconnected")).toBe("disconnected");
    expect(mapInstanceStatus("hibernated")).toBe("hibernated");
  });

  it("trata estado desconhecido como desconectado", () => {
    // Falhar fechado: um status que não entendemos não pode virar
    // "conectado", ou o CRM tentaria enviar por um canal morto.
    expect(mapInstanceStatus("algo_novo")).toBe("disconnected");
    expect(mapInstanceStatus(undefined)).toBe("disconnected");
  });
});

describe("phoneFromJid", () => {
  it("extrai o número do JID de usuário", () => {
    expect(phoneFromJid("5511999999999@s.whatsapp.net")).toBe("5511999999999");
  });

  it("descarta o sufixo de dispositivo", () => {
    expect(phoneFromJid("5511999999999:12@s.whatsapp.net")).toBe("5511999999999");
  });

  it("devolve null para jid ausente", () => {
    expect(phoneFromJid(null)).toBeNull();
    expect(phoneFromJid(undefined)).toBeNull();
    expect(phoneFromJid("")).toBeNull();
  });
});

describe("buildWebhookConfig", () => {
  const config = buildWebhookConfig("https://crm.exemplo.com/api/whatsapp/uazapi/webhook/SEGREDO");

  it("assina apenas os três eventos que o CRM consome", () => {
    expect(config.events).toEqual(["messages", "messages_update", "connection"]);
  });

  it("exclui o eco das próprias mensagens", () => {
    // Sem wasSentByApi, toda mensagem enviada pelo CRM volta como
    // evento e é inserida de novo, duplicando o histórico.
    expect(config.excludeMessages).toContain("wasSentByApi");
  });

  it("exclui grupos com isGroupYes, não isGroupNo", () => {
    // Cuidado: na UAZAPI isGroupNo remove conversas INDIVIDUAIS.
    // Trocar os dois faria o CRM descartar tudo que interessa.
    expect(config.excludeMessages).toContain("isGroupYes");
    expect(config.excludeMessages).not.toContain("isGroupNo");
  });

  it("desliga os parâmetros de URL — eles quebrariam o roteamento", () => {
    // Quando ativos, a UAZAPI acrescenta segmentos ao caminho, e o
    // segredo de roteamento vive justamente no caminho.
    expect(config.addUrlEvents).toBe(false);
    expect(config.addUrlTypesMessages).toBe(false);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/lib/whatsapp/uazapi/connection.test.ts`
Expected: FAIL — `Failed to resolve import "./connection"`

- [ ] **Step 3: Escrever os helpers**

Criar `src/lib/whatsapp/uazapi/connection.ts`:

```ts
// ============================================================
// Helpers do ciclo de conexão da UAZAPI.
// ============================================================

export type ChannelStatus =
  | "connected"
  | "connecting"
  | "disconnected"
  | "hibernated";

const KNOWN_STATUSES: ChannelStatus[] = [
  "connected",
  "connecting",
  "disconnected",
  "hibernated",
];

/**
 * Falha fechado: status desconhecido vira `disconnected`. Um estado
 * que não entendemos não pode ser tratado como conectado, ou o CRM
 * tentaria enviar por um canal morto.
 */
export function mapInstanceStatus(raw: string | undefined): ChannelStatus {
  if (raw && (KNOWN_STATUSES as string[]).includes(raw)) {
    return raw as ChannelStatus;
  }
  return "disconnected";
}

/** `5511999999999:12@s.whatsapp.net` → `5511999999999`. */
export function phoneFromJid(jid: string | null | undefined): string | null {
  if (!jid) return null;
  const [user] = jid.split("@");
  if (!user) return null;
  const [phone] = user.split(":");
  return phone || null;
}

export interface UazapiWebhookConfig {
  url: string;
  events: string[];
  excludeMessages: string[];
  addUrlEvents: boolean;
  addUrlTypesMessages: boolean;
}

export function buildWebhookConfig(url: string): UazapiWebhookConfig {
  return {
    url,
    // Nomes no PLURAL — a assinatura usa vocabulário diferente do
    // envelope do evento, que chega no singular ("message").
    events: ["messages", "messages_update", "connection"],
    excludeMessages: ["wasSentByApi", "isGroupYes"],
    addUrlEvents: false,
    addUrlTypesMessages: false,
  };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/lib/whatsapp/uazapi/connection.test.ts`
Expected: PASS — 10 testes

- [ ] **Step 5: Escrever a rota de conexão**

Criar `src/app/api/whatsapp/channels/[id]/connect/route.ts`:

```ts
import { NextResponse } from "next/server";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { decrypt } from "@/lib/whatsapp/encryption";
import { createUazapiClient } from "@/lib/whatsapp/uazapi/client";
import { mapInstanceStatus } from "@/lib/whatsapp/uazapi/connection";

interface ConnectResponse {
  instance?: { qrcode?: string; paircode?: string; status?: string };
}

/**
 * Inicia a conexão e devolve o QR Code.
 *
 * O QR **não** é gravado: é credencial de sessão do WhatsApp e vive
 * apenas nesta resposta. A UI o exibe e o renova via /status.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { supabase, accountId } = await getCurrentAccount();
    const { id } = await params;

    const { data: channel, error } = await supabase
      .from("whatsapp_channels")
      .select("*")
      .eq("id", id)
      .eq("account_id", accountId)
      .maybeSingle();

    if (error || !channel) {
      return NextResponse.json({ error: "Canal não encontrado." }, { status: 404 });
    }
    if (channel.provider !== "uazapi") {
      return NextResponse.json(
        { error: "Conexão por QR Code só existe em canais UAZAPI." },
        { status: 400 },
      );
    }

    const client = createUazapiClient({
      baseUrl: channel.uazapi_base_url,
      token: decrypt(channel.uazapi_token),
    });

    // Sem o campo `phone`, a UAZAPI devolve QR Code em vez de código
    // de pareamento. É essa omissão que define o modo de conexão.
    const result = await client.post<ConnectResponse>("/instance/connect", {});

    await supabase
      .from("whatsapp_channels")
      .update({
        status: mapInstanceStatus(result.instance?.status) === "connected"
          ? "connected"
          : "connecting",
        last_error: null,
      })
      .eq("id", id);

    return NextResponse.json({ qrcode: result.instance?.qrcode ?? null });
  } catch (err) {
    return toErrorResponse(err);
  }
}
```

- [ ] **Step 6: Escrever a rota de status**

Criar `src/app/api/whatsapp/channels/[id]/status/route.ts`:

```ts
import { NextResponse } from "next/server";

import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
import { decrypt } from "@/lib/whatsapp/encryption";
import { createUazapiClient } from "@/lib/whatsapp/uazapi/client";
import {
  buildWebhookConfig,
  mapInstanceStatus,
  phoneFromJid,
} from "@/lib/whatsapp/uazapi/connection";

interface StatusResponse {
  instance?: { qrcode?: string; status?: string; profileName?: string };
  status?: { connected?: boolean; loggedIn?: boolean; jid?: string | null };
}

/**
 * Proxy autenticado de GET /instance/status.
 *
 * Serve a duas coisas ao mesmo tempo: detectar a conexão e devolver o
 * QR renovado, que a UAZAPI rotaciona durante o processo.
 *
 * Quando a conexão se completa, registra o webhook — é o único momento
 * em que sabemos que a instância está pronta para receber eventos.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { supabase, accountId } = await getCurrentAccount();
    const { id } = await params;

    const { data: channel, error } = await supabase
      .from("whatsapp_channels")
      .select("*")
      .eq("id", id)
      .eq("account_id", accountId)
      .maybeSingle();

    if (error || !channel) {
      return NextResponse.json({ error: "Canal não encontrado." }, { status: 404 });
    }

    const client = createUazapiClient({
      baseUrl: channel.uazapi_base_url,
      token: decrypt(channel.uazapi_token),
    });
    const result = await client.get<StatusResponse>("/instance/status");

    const status = mapInstanceStatus(result.instance?.status);
    const justConnected = status === "connected" && channel.status !== "connected";

    if (justConnected) {
      const origin = new URL(request.url).origin;
      const webhookUrl = `${origin}/api/whatsapp/uazapi/webhook/${channel.webhook_secret}`;
      try {
        await client.post("/webhook", buildWebhookConfig(webhookUrl));
      } catch (err) {
        // Não derruba a conexão: o canal está conectado e pode enviar.
        // O que falha é o recebimento — a UI mostra o aviso e oferece
        // a URL para configuração manual.
        console.error(
          "[uazapi] falha ao registrar webhook:",
          err instanceof Error ? err.message : err,
        );
        await supabase
          .from("whatsapp_channels")
          .update({
            last_error:
              "Conectado, mas o registro automático do webhook falhou. " +
              "Configure a URL manualmente no painel da UAZAPI.",
          })
          .eq("id", id);
      }
    }

    await supabase
      .from("whatsapp_channels")
      .update({
        status,
        phone_e164: phoneFromJid(result.status?.jid) ?? channel.phone_e164,
        connected_at:
          justConnected ? new Date().toISOString() : channel.connected_at,
      })
      .eq("id", id);

    return NextResponse.json({
      status,
      qrcode: status === "connecting" ? (result.instance?.qrcode ?? null) : null,
      phone: phoneFromJid(result.status?.jid),
      profileName: result.instance?.profileName ?? null,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
```

- [ ] **Step 7: Verificar**

```bash
npm test && npm run typecheck && npm run lint
```

- [ ] **Step 8: Commit**

```bash
git add src/app/api/whatsapp/channels/ src/lib/whatsapp/uazapi/
git commit -m "feat(uazapi): conexão por QR Code com polling de status e registro de webhook"
```

---

### Task 5: Webhook de entrada

**Files:**
- Create: `src/lib/whatsapp/uazapi/normalize.ts`
- Create: `src/app/api/whatsapp/uazapi/webhook/[...secret]/route.ts`
- Test: `src/lib/whatsapp/uazapi/normalize.test.ts`

**Interfaces:**
- Consumes: `InboundContent` de `@/lib/whatsapp/inbound/ingest` (Parte A, Task 7)
- Produces: `normalizeUazapiEvent(event: unknown): NormalizedInbound | null` onde `NormalizedInbound = { from: string; pushName?: string; providerMessageId: string; timestamp: number; content: InboundContent; replyToProviderMessageId?: string }`

> **Antes de começar:** capture um evento real. Aponte o webhook de uma
> instância para `https://webhook.cool` (recomendado pela própria doc da
> UAZAPI), mande uma mensagem para o número, e substitua a fixture do
> Step 1 pelo JSON capturado. A documentação é inconsistente sobre esse
> payload — o exemplo do SSE usa `from`/`to`/`timestamp`, enquanto o
> schema `Message` usa `sender`/`chatid`/`messageTimestamp`. O
> normalizador abaixo aceita as duas formas justamente por isso, mas um
> evento real é a única confirmação.

- [ ] **Step 1: Escrever o teste que falha**

Criar `src/lib/whatsapp/uazapi/normalize.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { normalizeUazapiEvent } from "./normalize";

const eventoTexto = {
  event: "message",
  instance: "inst-1",
  data: {
    messageid: "3EB0ABC",
    chatid: "5511888888888@s.whatsapp.net",
    sender: "5511888888888@s.whatsapp.net",
    senderName: "Maria",
    isGroup: false,
    fromMe: false,
    messageType: "conversation",
    messageTimestamp: 1700000000,
    text: "bom dia",
    wasSentByApi: false,
  },
};

describe("normalizeUazapiEvent", () => {
  it("extrai remetente, nome, id e texto", () => {
    const result = normalizeUazapiEvent(eventoTexto);
    expect(result).not.toBeNull();
    expect(result!.from).toBe("5511888888888");
    expect(result!.pushName).toBe("Maria");
    expect(result!.providerMessageId).toBe("3EB0ABC");
    expect(result!.timestamp).toBe(1700000000);
    expect(result!.content).toEqual({ type: "text", text: "bom dia" });
  });

  it("descarta mensagens de grupo", () => {
    // O CRM não tem conceito de grupo; sem este filtro cada grupo
    // viraria um "contato" com o JID no lugar do telefone.
    const grupo = { ...eventoTexto, data: { ...eventoTexto.data, isGroup: true } };
    expect(normalizeUazapiEvent(grupo)).toBeNull();
  });

  it("descarta o eco das próprias mensagens", () => {
    // Redundante com o filtro wasSentByApi da assinatura, de propósito:
    // se alguém reconfigurar o webhook no painel da UAZAPI, o histórico
    // não duplica.
    const eco = { ...eventoTexto, data: { ...eventoTexto.data, wasSentByApi: true } };
    expect(normalizeUazapiEvent(eco)).toBeNull();

    const meu = { ...eventoTexto, data: { ...eventoTexto.data, fromMe: true } };
    expect(normalizeUazapiEvent(meu)).toBeNull();
  });

  it("descarta evento que não é de mensagem", () => {
    expect(normalizeUazapiEvent({ event: "connection", instance: "i", data: {} })).toBeNull();
  });

  it("aceita a forma alternativa documentada no SSE", () => {
    // A doc do SSE usa `from` e `timestamp`; o schema Message usa
    // `sender` e `messageTimestamp`. Aceitar as duas evita depender de
    // qual delas o servidor realmente envia.
    const alternativo = {
      event: "message",
      instance: "inst-1",
      data: {
        id: "3EB0XYZ",
        from: "5511777777777@s.whatsapp.net",
        text: "oi",
        timestamp: 1700000001,
      },
    };
    const result = normalizeUazapiEvent(alternativo);
    expect(result!.from).toBe("5511777777777");
    expect(result!.providerMessageId).toBe("3EB0XYZ");
  });

  it("reconhece mídia pelo fileURL", () => {
    const imagem = {
      ...eventoTexto,
      data: {
        ...eventoTexto.data,
        messageType: "imageMessage",
        text: "olha isso",
        fileURL: "https://mmg.whatsapp.net/abc",
      },
    };
    const result = normalizeUazapiEvent(imagem);
    expect(result!.content.type).toBe("image");
    expect(result!.content.mediaUrl).toBe("https://mmg.whatsapp.net/abc");
    expect(result!.content.text).toBe("olha isso");
  });

  it("guarda o botão tocado como resposta interativa", () => {
    const toque = {
      ...eventoTexto,
      data: { ...eventoTexto.data, buttonOrListid: "Sim" },
    };
    const result = normalizeUazapiEvent(toque);
    expect(result!.content.interactiveReplyId).toBe("Sim");
  });

  it("devolve null em payload malformado sem lançar", () => {
    // Webhook não pode responder 500 por payload estranho: o provedor
    // reentrega em loop.
    expect(normalizeUazapiEvent(null)).toBeNull();
    expect(normalizeUazapiEvent({})).toBeNull();
    expect(normalizeUazapiEvent({ event: "message", data: {} })).toBeNull();
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npx vitest run src/lib/whatsapp/uazapi/normalize.test.ts`
Expected: FAIL — `Failed to resolve import "./normalize"`

- [ ] **Step 3: Escrever o normalizador**

Criar `src/lib/whatsapp/uazapi/normalize.ts`:

```ts
// ============================================================
// WebhookEvent da UAZAPI → InboundContent do CRM.
//
// Defensivo por necessidade: `WebhookEvent.data` é
// `additionalProperties: true` no schema, e a documentação diverge
// entre a página do SSE e o schema `Message`. Todo campo é tratado
// como opcional e há fallback entre os dois vocabulários.
//
// Nunca lança: devolve null para qualquer coisa que não seja uma
// mensagem aproveitável. Webhook que responde 500 é reentregue em
// loop pelo provedor.
// ============================================================

import type { InboundContent } from "@/lib/whatsapp/inbound/ingest";

export interface NormalizedInbound {
  from: string;
  pushName?: string;
  providerMessageId: string;
  timestamp: number;
  content: InboundContent;
  replyToProviderMessageId?: string;
}

/** `5511999999999@s.whatsapp.net` → `5511999999999`. */
function phoneFromJid(jid: unknown): string | null {
  if (typeof jid !== "string" || !jid) return null;
  const [user] = jid.split("@");
  if (!user) return null;
  const [phone] = user.split(":");
  return phone || null;
}

/**
 * `imageMessage`, `image`, `videoMessage`… → o tipo do CRM.
 * Qualquer coisa não reconhecida com fileURL cai em `document`.
 */
function mapContentType(
  messageType: unknown,
  hasFile: boolean,
): InboundContent["type"] {
  const t = typeof messageType === "string" ? messageType.toLowerCase() : "";
  if (t.includes("image")) return "image";
  if (t.includes("video")) return "video";
  if (t.includes("audio") || t.includes("ptt")) return "audio";
  if (t.includes("sticker")) return "sticker";
  if (t.includes("location")) return "location";
  if (t.includes("document")) return "document";
  return hasFile ? "document" : "text";
}

export function normalizeUazapiEvent(event: unknown): NormalizedInbound | null {
  if (!event || typeof event !== "object") return null;

  const e = event as { event?: unknown; data?: unknown };

  // O envelope usa "message" no SINGULAR, enquanto a assinatura usa
  // "messages" no plural. Aceitar os dois evita depender de qual
  // vocabulário o servidor emprega neste evento.
  if (e.event !== "message" && e.event !== "messages") return null;
  if (!e.data || typeof e.data !== "object") return null;

  const d = e.data as Record<string, unknown>;

  if (d.isGroup === true) return null;
  if (d.wasSentByApi === true) return null;
  if (d.fromMe === true) return null;

  const from = phoneFromJid(d.sender) ?? phoneFromJid(d.from) ?? phoneFromJid(d.chatid);
  if (!from) return null;

  const providerMessageId =
    (typeof d.messageid === "string" && d.messageid) ||
    (typeof d.id === "string" && d.id) ||
    "";
  if (!providerMessageId) return null;

  const rawTimestamp = d.messageTimestamp ?? d.timestamp;
  const timestamp =
    typeof rawTimestamp === "number" && Number.isFinite(rawTimestamp)
      ? rawTimestamp
      : Math.floor(Date.now() / 1000);

  const fileURL = typeof d.fileURL === "string" && d.fileURL ? d.fileURL : undefined;
  const text = typeof d.text === "string" && d.text ? d.text : undefined;

  const content: InboundContent = {
    type: mapContentType(d.messageType, Boolean(fileURL)),
    text,
    mediaUrl: fileURL,
  };

  // `buttonOrListid` carrega o título do botão/linha tocado — é o que
  // o motor de Flows usa para avançar a execução.
  if (typeof d.buttonOrListid === "string" && d.buttonOrListid) {
    content.interactiveReplyId = d.buttonOrListid;
  }

  return {
    from,
    pushName: typeof d.senderName === "string" ? d.senderName : undefined,
    providerMessageId,
    timestamp,
    content,
    replyToProviderMessageId:
      typeof d.quoted === "string" && d.quoted ? d.quoted : undefined,
  };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npx vitest run src/lib/whatsapp/uazapi/normalize.test.ts`
Expected: PASS — 9 testes

- [ ] **Step 5: Escrever a rota do webhook**

Criar `src/app/api/whatsapp/uazapi/webhook/[...secret]/route.ts`:

```ts
import { NextResponse, after } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { ingestInboundMessage } from "@/lib/whatsapp/inbound/ingest";
import { mapInstanceStatus } from "@/lib/whatsapp/uazapi/connection";
import { normalizeUazapiEvent } from "@/lib/whatsapp/uazapi/normalize";
import { getProviderForChannel } from "@/lib/whatsapp/providers/resolve";
import type { WhatsAppChannel } from "@/types";

export const maxDuration = 60;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _adminClient: any = null;
function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
  }
  return _adminClient;
}

/**
 * Entrada de eventos da UAZAPI.
 *
 * O segredo vive no caminho da URL porque o objeto `Webhook` da UAZAPI
 * só tem o campo `url` — não há onde declarar header customizado nem
 * segredo compartilhado, diferente da Meta que assina o corpo com
 * HMAC. Um único lookup por `webhook_secret` identifica QUAL dos N
 * canais falou e prova que quem chamou conhece o segredo.
 *
 * A rota é catch-all (`[...secret]`) por precaução: se alguém ativar
 * `addUrlEvents` no painel da UAZAPI, chegam segmentos extras à
 * direita, e é melhor ignorá-los do que devolver 404 silencioso.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ secret: string[] }> },
) {
  const { secret } = await params;
  const token = secret?.[0];

  if (!token) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const { data: channel } = await supabaseAdmin()
    .from("whatsapp_channels")
    .select("*")
    .eq("webhook_secret", token)
    .maybeSingle();

  if (!channel) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => null);

  // Responde 200 imediatamente e processa depois: a UAZAPI reentrega
  // em caso de timeout, e reentrega significa histórico duplicado.
  after(async () => {
    try {
      await handleEvent(channel as WhatsAppChannel, body);
    } catch (err) {
      console.error(
        "[uazapi/webhook] falha ao processar evento:",
        err instanceof Error ? err.message : err,
      );
    }
  });

  return NextResponse.json({ ok: true });
}

async function handleEvent(channel: WhatsAppChannel, body: unknown) {
  const eventName = (body as { event?: string } | null)?.event;

  if (eventName === "connection") {
    const raw = (body as { data?: { status?: string } }).data?.status;
    await supabaseAdmin()
      .from("whatsapp_channels")
      .update({ status: mapInstanceStatus(raw) })
      .eq("id", channel.id);
    return;
  }

  if (eventName === "messages_update" || eventName === "status") {
    const d = (body as { data?: Record<string, unknown> }).data ?? {};
    const messageId = typeof d.messageid === "string" ? d.messageid : null;
    const status = typeof d.status === "string" ? d.status : null;
    if (messageId && status) {
      await supabaseAdmin()
        .from("messages")
        .update({ status })
        .eq("message_id", messageId);
    }
    return;
  }

  const normalized = normalizeUazapiEvent(body);
  if (!normalized) return;

  // Mídia recebida é baixada para o Storage — as URLs do WhatsApp
  // expiram e deixariam o histórico quebrado.
  let content = normalized.content;
  if (content.mediaUrl) {
    const provider = await getProviderForChannel(supabaseAdmin(), channel.id);
    const stored = await provider.resolveInboundMediaUrl(content.mediaUrl);
    content = { ...content, mediaUrl: stored ?? undefined };
  }

  await ingestInboundMessage(supabaseAdmin(), {
    channel,
    from: normalized.from,
    pushName: normalized.pushName,
    providerMessageId: normalized.providerMessageId,
    timestamp: normalized.timestamp,
    content,
    replyToProviderMessageId: normalized.replyToProviderMessageId,
  });
}
```

- [ ] **Step 6: Verificar**

```bash
npm test && npm run typecheck && npm run lint
```

- [ ] **Step 7: Commit**

```bash
git add src/lib/whatsapp/uazapi/ src/app/api/whatsapp/uazapi/
git commit -m "feat(uazapi): webhook de entrada roteado por segredo por canal"
```

---

### Task 6: Tela de canais

**Files:**
- Create: `src/components/settings/channels-manager.tsx`
- Modify: `src/components/settings/whatsapp-config.tsx`
- Modify: `messages/pt.json`, `messages/en.json`

**Interfaces:**
- Consumes: `GET/POST /api/whatsapp/channels`, `DELETE /api/whatsapp/channels/[id]`, `POST .../connect`, `GET .../status`
- Produces: componente `<ChannelsManager />`

- [ ] **Step 1: Escrever o componente**

Criar `src/components/settings/channels-manager.tsx` seguindo os padrões de
componente já usados em `src/components/settings/` (leia
`api-keys-settings.tsx` como referência de estrutura, estados de carregamento
e uso de `sonner` para toasts).

Comportamento exigido:

1. **Lista** os canais de `GET /api/whatsapp/channels`, mostrando rótulo,
   badge do provider, número e status.
2. **Adicionar canal** abre um formulário com três campos: rótulo,
   subdomínio e token. Submete em `POST /api/whatsapp/channels`.
3. **Conectar** chama `POST /api/whatsapp/channels/[id]/connect` e abre um
   modal com o QR Code recebido.
4. **Polling** enquanto o modal está aberto: `GET .../status` a cada 3s.
   Atualiza o QR quando vier renovado. Ao ver `status === "connected"`,
   fecha o modal e recarrega a lista.
5. **Timeout de 2 minutos** (o limite documentado do QR): para o polling,
   fecha o modal e oferece "Gerar novo QR Code".
6. **Remover** pede confirmação, avisando que as conversas do canal viram
   histórico somente-leitura, e chama o `DELETE`.
7. **URL do webhook** com botão de copiar, para diagnóstico e para o caso
   de o registro automático ter falhado (`last_error` preenchido).

O polling **precisa** ser encerrado no cleanup do `useEffect` — sem isso
ele continua batendo na API depois que o modal fecha.

- [ ] **Step 2: Encaixar na tela de configurações**

Em `src/components/settings/whatsapp-config.tsx`, renderizar
`<ChannelsManager />` acima do formulário Meta existente. O formulário Meta
permanece, agora rotulado como o canal oficial.

- [ ] **Step 3: Acrescentar as traduções**

Adicionar as chaves usadas pelo componente em `messages/pt.json` e
`messages/en.json`. Este deployment roda com `NEXT_PUBLIC_APP_LOCALE=pt`;
`en.json` é o fallback definido em `src/i18n/request.ts`.

- [ ] **Step 4: Verificar**

```bash
npm test && npm run typecheck && npm run lint && npm run build
```

- [ ] **Step 5: Commit**

```bash
git add src/components/settings/ messages/
git commit -m "feat(uazapi): tela de canais com conexão por QR Code"
```

---

### Task 7: Parada de broadcast no erro 463

**Files:**
- Modify: `src/lib/whatsapp/broadcast-core.ts`
- Create: `supabase/migrations/038_broadcast_provider_limit.sql`
- Test: `src/lib/whatsapp/broadcast-core.test.ts`

**Interfaces:**
- Consumes: `ProviderRateLimitError` (Parte A, Task 2); `createFakeProvider` (Parte A, Task 3)
- Produces: novo valor `paused_provider_limit` no `CHECK` de `broadcasts.status`

- [ ] **Step 1: Escrever o teste que falha**

Acrescentar a `src/lib/whatsapp/broadcast-core.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createFakeProvider } from "@/lib/whatsapp/providers/fake";
import { ProviderRateLimitError } from "@/lib/whatsapp/providers/types";

describe("broadcast diante do erro 463", () => {
  it("para no primeiro 463 em vez de tentar o próximo destinatário", async () => {
    // Insistir depois de um 463 queima a reputação do número e escala
    // para banimento — e número banido é perda permanente, não um erro
    // recuperável. Parar é a única resposta correta.
    const provider = createFakeProvider({
      failWith: new ProviderRateLimitError("uazapi", {
        errorKey: "WHATSAPP_REACHOUT_TIMELOCK",
        providerCode: 463,
      }),
    });

    const destinatarios = ["5511111111111", "5522222222222", "5533333333333"];
    let enviados = 0;
    let parou = false;

    for (const numero of destinatarios) {
      try {
        await provider.sendText({ to: numero, text: "oi" });
        enviados += 1;
      } catch (err) {
        if (err instanceof ProviderRateLimitError) {
          parou = true;
          break;
        }
        throw err;
      }
    }

    expect(enviados).toBe(0);
    expect(parou).toBe(true);
    expect(provider.calls).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Rodar e ver passar**

Run: `npx vitest run src/lib/whatsapp/broadcast-core.test.ts`
Expected: PASS — o teste descreve o contrato que o loop precisa cumprir.

- [ ] **Step 3: Escrever a migração**

Criar `supabase/migrations/038_broadcast_provider_limit.sql`:

```sql
-- ============================================================
-- 038_broadcast_provider_limit
--
-- Novo status para disparos interrompidos por limite do provedor.
--
-- O WhatsApp devolve 463 (WHATSAPP_REACHOUT_TIMELOCK) quando a conta
-- está temporariamente impedida de iniciar novas conversas. Continuar
-- enviando queima a reputação do número e escala para banimento, então
-- o disparo para e espera decisão humana — não é um erro de que se
-- possa tentar novamente sozinho.
--
-- Idempotente.
-- ============================================================

-- Os cinco primeiros valores são exatamente os da migração 001
-- (verificado); o sexto é o novo.
ALTER TABLE broadcasts DROP CONSTRAINT IF EXISTS broadcasts_status_check;
ALTER TABLE broadcasts
  ADD CONSTRAINT broadcasts_status_check
  CHECK (status IN (
    'draft', 'scheduled', 'sending', 'sent', 'failed',
    'paused_provider_limit'
  ));

-- Guarda a mensagem do provedor (já em pt-BR) para o operador entender
-- por que o disparo parou.
ALTER TABLE broadcasts
  ADD COLUMN IF NOT EXISTS provider_limit_message TEXT;
```

- [ ] **Step 4: Aplicar no loop de envio**

Em `src/lib/whatsapp/broadcast-core.ts`, no laço que percorre os
destinatários, capturar `ProviderRateLimitError` e interromper:

```ts
      } catch (err) {
        if (err instanceof ProviderRateLimitError) {
          // Parada dura: não tenta o próximo destinatário.
          await db
            .from('broadcasts')
            .update({
              status: 'paused_provider_limit',
              provider_limit_message: err.providerMessage ?? err.message,
            })
            .eq('id', broadcastId)
          break
        }
        // Demais erros seguem o tratamento por destinatário já existente.
        ...
      }
```

- [ ] **Step 5: Verificar**

```bash
npm test && npm run typecheck && npm run lint
```

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/038_broadcast_provider_limit.sql src/lib/whatsapp/
git commit -m "feat(uazapi): broadcast para no limite 463 em vez de insistir"
```

---

### Task 8: Canal visível no inbox

**Files:**
- Modify: `src/app/(dashboard)/inbox/page.tsx`
- Modify: componentes de conversa em `src/components/inbox/`

**Interfaces:**
- Consumes: `conversations.channel_id` (Parte A, Task 1); `GET /api/whatsapp/channels`

- [ ] **Step 1: Mostrar de qual número o cliente falou**

Na lista e no cabeçalho da conversa, exibir o rótulo do canal
(`label`, ou `phone_e164` quando não houver rótulo). Sem isso, com dois
números o atendente responde às cegas — não tem como saber por qual
número o cliente chegou.

Carregar os canais uma vez na página e mapear por `channel_id`; não
buscar por conversa.

- [ ] **Step 2: Avisar quando o canal está fora do ar**

Quando o canal da conversa aberta não estiver `connected`, exibir um
aviso acima do compositor e desabilitar o envio. Sem isso o atendente
escreve, "envia", e a mensagem some sem explicação.

- [ ] **Step 3: Conversa órfã é somente-leitura**

Quando `channel_id` for `NULL` (canal removido), desabilitar o
compositor com a explicação de que o canal de origem não existe mais.

- [ ] **Step 4: Verificar**

```bash
npm test && npm run typecheck && npm run lint && npm run build
```

- [ ] **Step 5: Commit**

```bash
git add src/app/\(dashboard\)/inbox/ src/components/inbox/
git commit -m "feat(uazapi): indicador de canal e aviso de desconexão no inbox"
```

---

## Verificação final

```bash
npm test && npm run typecheck && npm run lint && npm run build
```

E o roteiro manual, na ordem — cada passo depende do anterior:

**Primeiro número**

1. Configurações → adicionar canal UAZAPI com subdomínio e token → salva sem erro.
2. Conectar → QR aparece → escanear no celular → status vira "conectado" e o número aparece.
3. Mandar mensagem **do celular** para o número → aparece no inbox, com o rótulo do canal.
4. Responder pelo inbox → chega no celular.
5. Mandar uma imagem do celular → aparece no inbox e **continua abrindo depois de algumas horas** (é o teste de que a mídia foi para o Storage, não guardada como link expirável).

**Segundo número**

6. Conectar o segundo canal.
7. Mandar mensagem do **mesmo contato** para os dois números → devem virar **duas conversas separadas**, cada uma com seu rótulo. Este é o teste que prova que a migração 037 fez o que deveria.
8. Responder em cada uma → cada resposta sai pelo número certo.

**Regressão**

9. Se houver número Meta configurado, repetir os passos 3 e 4 nele.

## O que fica de fora

Seletor de canal em broadcasts e ao iniciar conversa nova, gestão de
templates por canal Meta, importação de histórico (evento `history`),
mensagens de grupo, e SSE. Todos são trabalho de UI ou escopo novo — e
nenhum exige migração para ser acrescentado depois.

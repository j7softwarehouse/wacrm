# Suporte a UAZAPI e multi-canal WhatsApp

**Data:** 2026-07-27
**Status:** aprovado, pronto para plano de implementação

## 1. Objetivo

Permitir que uma conta do CRM conecte múltiplos números de WhatsApp, de dois
provedores diferentes:

- **Meta Cloud API** — a integração oficial que já existe.
- **UAZAPI** — API não-oficial, conectada por leitura de QR Code na tela de
  Configurações.

O usuário final já possui (ou cria) sua própria instância UAZAPI em algum
provedor e cola o subdomínio e o token da instância no CRM. O CRM nunca usa
`admintoken` e nunca cria instâncias.

**Prioridade declarada:** o canal UAZAPI operando com 2 números é o resultado
que importa. Paridade de funcionalidades da Meta é secundária.

## 2. Escopo

### Incluído

- Tabela `whatsapp_channels` substituindo `whatsapp_config`, com N canais por
  conta e uma coluna `provider`.
- `channel_id` em `conversations` e `broadcasts`; toda resolução de credencial
  passa a partir da conversa, não da conta.
- Camada de adapter `WhatsAppProvider` com duas implementações.
- Conexão UAZAPI por QR Code, com polling de status e reconexão.
- Webhook de entrada da UAZAPI, roteado por segredo por canal.
- Envio de texto, mídia, interativos e reações pelos dois provedores.
- Broadcasts, Flows, Automations e AI auto-reply funcionando em ambos.
- UI de canais, seletor de canal em broadcasts e nova conversa, indicador de
  canal no inbox.

### Excluído desta entrega

- **Importação de histórico.** O evento `history` da UAZAPI não é assinado.
  Ao ler o QR, a UAZAPI despeja o histórico sincronizado; importar isso criaria
  centenas de contatos e conversas sem curadoria na primeira conexão.
  Reversível depois — basta assinar o evento.
- **Mensagens de grupo.** O CRM não tem conceito de grupo. Sem filtro, cada
  grupo viraria um "contato" com o JID no lugar do telefone.
- **SSE.** A UAZAPI oferece Server-Sent Events como alternativa ao webhook.
  Webhook é o mesmo modelo que a Meta já usa; SSE exigiria uma conexão
  persistente por canal, incompatível com deploy serverless.
- **Migração de contas Meta existentes para múltiplos números.** O backfill
  cria exatamente um canal Meta por conta existente.

### Degradações explícitas (não são bugs)

| Caminho | Comportamento |
|---|---|
| Templates (`submit` / `sync` / `[id]`) | Presos ao canal Meta **mais antigo** da conta (`provider='meta'` ordenado por `created_at ASC`, desempate por `id`). Com 2 números Meta, o segundo não gerencia templates. |
| Registro Meta (`/register`, `subscribed_apps`) | Idem — vinculado ao mesmo canal. |
| `sendTemplate` em canal UAZAPI | Lança `ProviderUnsupportedError`. Templates aprovados são um conceito exclusivo da Meta; não existem na UAZAPI. A UI esconde as funcionalidades de template para canais UAZAPI, e o erro é apenas a rede de proteção. |

## 3. Modelo de dados

### 3.1 `whatsapp_config` → `whatsapp_channels`

Rename, não apenas novas colunas: `config` no singular afirma "uma por conta",
que é a premissa que está sendo removida. As constraints e políticas RLS
precisam ser reescritas de qualquer forma, então o rename não acrescenta risco.

```sql
whatsapp_channels (
  id           UUID PRIMARY KEY,
  account_id   UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  provider     TEXT NOT NULL CHECK (provider IN ('meta','uazapi')),
  label        TEXT,          -- "Recepção", "Financeiro" — nomeado pelo usuário
  phone_e164   TEXT,          -- preenchido após conectar
  status       TEXT NOT NULL DEFAULT 'disconnected'
               CHECK (status IN ('disconnected','connecting','connected','hibernated')),
  connected_at TIMESTAMPTZ,
  last_error   TEXT,

  -- Meta (nulos quando provider='uazapi')
  phone_number_id TEXT,
  waba_id         TEXT,
  access_token    TEXT,       -- AES-256-GCM
  verify_token    TEXT,       -- AES-256-GCM
  registered_at   TIMESTAMPTZ,
  subscribed_apps_at TIMESTAMPTZ,
  last_registration_error TEXT,

  -- UAZAPI (nulos quando provider='meta')
  uazapi_base_url    TEXT,    -- https://<subdomínio>.uazapi.com
  uazapi_token       TEXT,    -- token da instância, AES-256-GCM
  uazapi_instance_id TEXT,
  webhook_secret     TEXT,    -- 32 bytes aleatórios; chave de roteamento inbound

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
)
```

**Constraints:**

- `UNIQUE(account_id)` é **removida**. É a mudança central da migração.
- `UNIQUE(phone_number_id) WHERE phone_number_id IS NOT NULL` — parcial, senão
  todos os canais UAZAPI colidiriam em `NULL`. O raciocínio da migração 013
  (um número Meta por conta, para o webhook não ficar ambíguo) continua
  valendo para os canais Meta.
- `UNIQUE(uazapi_base_url, uazapi_instance_id)` parcial, pelo mesmo motivo:
  duas contas não podem reivindicar a mesma instância.
- `UNIQUE(webhook_secret)`.
- `CHECK` por provider: `meta` exige `phone_number_id` e `access_token`;
  `uazapi` exige `uazapi_base_url` e `uazapi_token`. Impede meia-configuração
  gravada no banco.

**RLS:** espelha o padrão da migração 017 — leitura por membros da conta,
escrita por admins+. As colunas de token **nunca** são expostas ao cliente
(ver 3.4).

### 3.2 `conversations`

```sql
ALTER TABLE conversations
  ADD COLUMN channel_id UUID REFERENCES whatsapp_channels(id) ON DELETE SET NULL;
```

`SET NULL` porque remover um canal não pode evaporar o histórico. A conversa
fica órfã e somente-leitura. Há precedente: a migração 004 fez o mesmo com
contatos.

A constraint da migração 036 é substituída:

```sql
-- antes: UNIQUE (account_id, contact_id)
-- depois:
UNIQUE NULLS NOT DISTINCT (account_id, contact_id, channel_id)
```

`NULLS NOT DISTINCT` é essencial. Sem ele, conversas órfãs (`channel_id IS
NULL`) voltariam a duplicar, que é exatamente o bug #363 que a migração 036
corrigiu — em Postgres, `NULL` é distinto de `NULL` num índice único comum.

### 3.3 `broadcasts`

`channel_id UUID REFERENCES whatsapp_channels(id) ON DELETE SET NULL`, **nullable
no schema**, obrigatório na aplicação para novos disparos.

A tentação é `NOT NULL`, já que todo disparo sai de um número específico. Mas
isso introduz um modo de falha na migração: uma conta que apagou sua config
antes desta entrega tem broadcasts históricos sem canal resolvível, e o
`SET NOT NULL` abortaria a migração inteira — o mesmo tipo de armadilha que a
013 documenta. Broadcasts antigos ficam com `channel_id NULL` (histórico, não
reenviável) e a validação de obrigatoriedade vive na criação.

### 3.4 O que **não** muda

- **`messages` não ganha `channel_id`.** É derivável da conversa; denormalizar
  cria uma segunda fonte de verdade para manter sincronizada.
- **`contacts` continua compartilhado entre canais.** O mesmo cliente falando
  com dois números é o mesmo contato; o que se separa é a conversa.

### 3.5 Backfill

Determinístico, porque hoje existe no máximo uma config por conta:

1. Cada linha de `whatsapp_config` vira um canal `provider='meta'`.
2. `conversations.channel_id` ← o canal único da conta.
3. `broadcasts.channel_id` ← idem. Linhas de contas sem config permanecem
   `NULL` (ver 3.3) — não abortam a migração.

Nenhum passo escolhe entre alternativas, porque hoje existe no máximo uma
config por conta. A migração é idempotente, no estilo das 013 / 022 / 036.

### 3.6 Correção de rota incluída

Hoje `src/components/settings/whatsapp-config.tsx` e
`src/components/settings/settings-overview.tsx` leem `whatsapp_config`
**direto do browser**, entregando as colunas de token (criptografadas, mas
ainda assim) ao cliente. Com N canais isso multiplica.

A nova tabela nunca é lida direto do cliente. A UI consome
`GET /api/whatsapp/channels`, que devolve apenas campos não-sensíveis.

## 4. Camada de provider

### 4.1 Estrutura

```
src/lib/whatsapp/providers/
  types.ts     — interface e erros tipados
  meta.ts      — embrulha o meta-api.ts atual; sem lógica nova
  uazapi.ts    — cliente HTTP novo
  resolve.ts   — getProviderForChannel / getProviderForConversation
```

```ts
export interface WhatsAppProvider {
  readonly kind: 'meta' | 'uazapi'
  sendText(args): Promise<SendResult>
  sendMedia(args): Promise<SendResult>
  sendInteractiveButtons(args): Promise<SendResult>
  sendInteractiveList(args): Promise<SendResult>
  sendReaction(args): Promise<SendResult>
  sendTemplate(args): Promise<SendResult>
  resolveInboundMediaUrl(ref): Promise<string | null>
}
```

`SendResult` é `{ messageId: string }` — já é a forma de `MetaSendResult`, então
os call sites não mudam de contrato, apenas de origem.

**`src/lib/whatsapp/meta-api.ts` não é modificado.** É o arquivo mais delicado
(35 KB) e o que mais conflita em merges com o `upstream`. `meta.ts` é um
invólucro fino sobre ele.

### 4.2 O resolver

`getProviderForConversation(db, conversationId)` carrega a conversa, encontra o
`channel_id`, lê a linha do canal, descriptografa a credencial e devolve o
adapter já carregado.

Consequência: **nenhum call site volta a manipular token.** Some o padrão
`decrypt(config.access_token)` hoje repetido em 6 arquivos, e some com ele a
chance de um token vazar num log.

### 4.3 Call sites afetados

De:

```ts
const config = await db.from('whatsapp_config')…single()
const accessToken = decrypt(config.access_token)
await sendTextMessage({ phoneNumberId: config.phone_number_id, accessToken, to, text })
```

para:

```ts
const provider = await getProviderForConversation(db, conversationId)
await provider.sendText({ to, text })
```

Seis arquivos:

| Arquivo | Observação |
|---|---|
| `src/lib/whatsapp/send-message.ts` | funil do inbox e da API pública |
| `src/lib/whatsapp/broadcast-core.ts` | |
| `src/lib/flows/meta-send.ts` | renomear para `send.ts` |
| `src/lib/automations/meta-send.ts` | renomear para `send.ts` |
| `src/app/api/whatsapp/react/route.ts` | |
| `src/lib/ai/auto-reply.ts` | |

Os dois `meta-send.ts` deixam de ser específicos da Meta, daí o rename.

### 4.4 Mapeamento UAZAPI

| Primitiva | Endpoint UAZAPI |
|---|---|
| `sendText` | `POST /send/text` — `{ number, text, replyid, delay, mentions }` |
| `sendMedia` | `POST /send/media` — `{ number, type, file, text, docName }` |
| `sendInteractiveButtons` / `List` | "Enviar menu interativo" — schema pendente |
| `sendReaction` | "Enviar reação a uma mensagem" — schema pendente |
| `sendTemplate` | não existe — lança `ProviderUnsupportedError` |

Tipos de mídia: os quatro do CRM (`image`, `video`, `document`, `audio`) mapeiam
diretamente. A UAZAPI oferece mais (`ptt`, `myaudio`, `sticker`, `ptv`,
`videoplay`) — fora de escopo.

### 4.5 Mídia recebida

- **Meta:** mantém o proxy preguiçoso `/api/whatsapp/media/<id>`, buscado sob
  demanda com o token da conta.
- **UAZAPI:** o evento traz `fileURL`, mas URLs do WhatsApp expiram — guardar o
  link cru deixaria a mídia quebrada no histórico em poucas horas. O adapter
  baixa uma vez e grava no Supabase Storage via o `uploadAccountMedia` que já
  existe em `src/lib/storage/upload-media.ts`.

## 5. Conexão por QR Code

Todos os passos são server-side; o token da instância nunca chega ao browser.

1. **Cadastrar.** Configurações → WhatsApp → *Adicionar canal* → UAZAPI. O
   usuário informa rótulo, subdomínio e token da instância.
   `POST /api/whatsapp/channels` valida chamando `GET /instance/status`
   **antes** de gravar — credencial errada falha aqui, com mensagem clara, sem
   deixar linha morta no banco. Grava `status='disconnected'`, token
   criptografado e `webhook_secret` gerado.

2. **Conectar.** `POST /api/whatsapp/channels/[id]/connect` chama
   `POST /instance/connect` **sem** o campo `phone` — é isso que faz a UAZAPI
   devolver QR em vez de código de pareamento. A resposta traz
   `instance.qrcode` como `data:image/png;base64,…`. Grava `status='connecting'`.

3. **Exibir e rotacionar.** A UI faz polling de
   `GET /api/whatsapp/channels/[id]/status` a cada 3s — proxy autenticado para
   `GET /instance/status`, que devolve tanto o estado quanto o QR renovado.
   **O QR nunca é persistido**: é efêmero e trafega só na resposta. Gravá-lo
   seria armazenar uma credencial de sessão do WhatsApp sem necessidade.

4. **Conectado.** Quando `status.loggedIn` vira `true`: grava
   `status='connected'`, `connected_at`, e extrai `phone_e164` do `jid`.
   Em seguida registra o webhook da instância (ver 6.1).

5. **Timeout.** A doc dá 2 minutos para o QR. Passando disso, o polling para,
   o status volta a `disconnected`, e a UI oferece *"Gerar novo QR Code"*.

**Reconexão.** Sessão de API não-oficial cai — celular sem bateria, logout pelo
aparelho, `hibernated`. Três defesas: o evento `connection` do webhook atualiza
`status`; a tela de canais reflete o estado real; e o inbox avisa quando o canal
da conversa não está `connected`, para o atendente não digitar uma resposta que
nunca sai.

## 6. Entrada de mensagens

### 6.1 Registro do webhook

Feito automaticamente ao conectar, com o token da instância. O corpo segue o
schema `Webhook` confirmado em `POST /globalwebhook`:

```json
{
  "url": "https://<host>/api/whatsapp/uazapi/webhook/<webhook_secret>",
  "events": ["messages", "messages_update", "connection"],
  "excludeMessages": ["wasSentByApi", "isGroupYes"],
  "addUrlEvents": false,
  "addUrlTypesMessages": false
}
```

`addUrlEvents` e `addUrlTypesMessages` **precisam** ser `false` explicitamente:
quando ativos, a UAZAPI acrescenta segmentos ao caminho
(`/webhook/{evento}/{tipo}`), e como o segredo vive no caminho, isso quebraria o
roteamento. Por precaução, a rota tolera segmentos extras à direita em vez de
responder 404.

A tela de canais também exibe a URL gerada com um botão de copiar — serve de
diagnóstico quando se suspeita que o webhook está errado, e de saída manual se
o registro automático falhar.

### 6.2 Filtros

| Filtro | Efeito | Motivo |
|---|---|---|
| `wasSentByApi` | remove mensagens originadas pela API | Sem ele, toda mensagem que o CRM envia volta como evento `messages` e é inserida de novo. A doc da UAZAPI recomenda explicitamente esse filtro. |
| `isGroupYes` | remove mensagens de grupos | O CRM não tem conceito de grupo. |

**Atenção à nomenclatura:** na UAZAPI, `isGroupYes` remove grupos e `isGroupNo`
remove conversas individuais — o oposto da leitura natural dos nomes. Trocar os
dois faria o CRM descartar exatamente as mensagens que interessam. A
normalização também descarta `isGroup === true` do nosso lado, como redundância.

### 6.3 A rota

```
POST /api/whatsapp/uazapi/webhook/[secret]
```

Busca o canal por `webhook_secret` (UNIQUE, indexado). Não achou → 404. Um único
lookup identifica *qual dos N canais* falou e prova que quem chamou conhece o
segredo.

O segredo vai no caminho da URL, não num header, porque o objeto `Webhook` da
UAZAPI só tem o campo `url` — não há onde declarar header customizado nem
segredo compartilhado. Diferente da Meta, que assina o corpo com HMAC-SHA256.
URL secreta é a resposta padrão para essa limitação.

| Evento | Ação |
|---|---|
| `messages` | normaliza → ingestão compartilhada |
| `messages_update` | atualiza `messages.status` (entregue/lido) |
| `connection` | atualiza `whatsapp_channels.status` |

**Idempotência:** índice único em `messages.message_id`. Webhook é
*at-least-once*; `wasSentByApi` evita o eco, o índice cobre a reentrega.

### 6.4 Extração do núcleo de ingestão

`src/app/api/whatsapp/webhook/route.ts` tem 1113 linhas misturando três
responsabilidades: verificar a assinatura da Meta, traduzir o payload da Meta, e
a lógica de negócio (achar/criar contato, achar/criar conversa, gravar mensagem,
disparar automations/flows/AI/webhooks).

Só a terceira é compartilhável. Ela sai para
`src/lib/whatsapp/inbound/ingest.ts`:

```ts
ingestInboundMessage({ channel, from, pushName, providerMessageId, timestamp, content })
```

Cada rota fica fina:

- **Meta:** verifica HMAC → traduz payload Meta → `ingest()`
- **UAZAPI:** resolve canal pelo segredo → traduz payload UAZAPI → `ingest()`

`findOrCreateConversation` passa a receber o canal — é isso que faz dois números
conviverem sem misturar conversas.

**Esta é a maior fonte de risco da entrega.** O caminho Meta tem pouca cobertura
de teste hoje, e uma regressão aqui é silenciosa (mensagens simplesmente param
de entrar). Mitigação obrigatória no plano: extrair **sem mudar comportamento**,
com testes cobrindo o fluxo Meta atual escritos **antes**, e só então plugar a
UAZAPI. Refactor e feature em commits separados.

## 7. Erros e limites

### 7.1 O erro 463 do WhatsApp

`POST /send/text` documenta uma resposta 500 estruturada:

```json
{ "error_key": "WHATSAPP_REACHOUT_TIMELOCK", "provider_code": 463,
  "error_source": "whatsapp_server",
  "diagnostics_endpoint": "/instance/wa_messages_limits",
  "message_ptbr": "O servidor do WhatsApp recusou esta mensagem…" }
```

Isso não tem equivalente no mundo Meta: o WhatsApp restringe temporariamente a
conta de **iniciar novas conversas**, por volume ou qualidade.

**Regra:** ao receber 463 num broadcast, o disparo **para** — não repete, não
tenta o próximo destinatário. Insistir queima a reputação do número e escala
para banimento, e um número banido é perda permanente, não um erro recuperável.
O broadcast fica `paused_provider_limit` — **novo valor** a acrescentar ao
`CHECK` de `broadcasts.status` — com a mensagem do provedor visível, e o
operador decide se retoma.

### 7.2 Erros tipados

Erros da UAZAPI viram tipos, não strings: `ProviderRateLimitError` carregando
`error_key` e `provider_code`; `ProviderUnsupportedError` para capacidades
inexistentes. Como a API já devolve `message_ptbr`, este deployment (locale
`pt`) mostra a mensagem original do WhatsApp em português, sem tradução nossa.

### 7.3 Canal desconectado

Se o canal não está `connected`, o envio falha antes de sair da aplicação, com
mensagem clara. Sem isso, o atendente escreve, "envia", e a mensagem some.

## 8. UI

| Onde | O quê |
|---|---|
| Configurações | Lista de canais (rótulo, badge do provider, número, status); adicionar/remover; modal do QR; URL do webhook com botão de copiar |
| Inbox | Badge do canal na conversa; aviso quando o canal está fora do ar |
| Broadcasts | Seletor de canal, obrigatório |
| Nova conversa | Seletor do número de origem — ponto de decisão que hoje não existe |
| Templates | Escondidos em canais UAZAPI |

## 9. Testes

1. **`FakeProvider`** em memória — permite testar `sendMessageToConversation`,
   broadcasts e flows sem mockar `fetch`, que é como os testes atuais sofrem.
   Este é o ganho lateral que justifica a interface.
2. **Fixtures do payload UAZAPI** para a normalização inbound.
3. **Cobertura do fluxo Meta antes da extração do `ingest`** — rede de proteção
   para o refactor de maior risco.

## 10. Riscos

| Risco | Mitigação |
|---|---|
| Regressão silenciosa no inbound da Meta | Testes antes da extração; refactor sem mudança de comportamento, em commit separado |
| Migração sobre dados de produção (rename + constraint 036) | Backfill determinístico; `NULLS NOT DISTINCT`; migração idempotente no estilo das 013/022/036 |
| Divergência com o `upstream` | `meta-api.ts` intocado; código novo isolado em `providers/` e `inbound/` |
| Número banido por insistir em 463 | Broadcast para no primeiro 463 |
| Sessão UAZAPI cai sem ninguém notar | Evento `connection` + status na tela de canais + aviso no inbox |

## 11. Lacunas de documentação em aberto

Não bloqueiam a spec nem o início da implementação — o schema, a camada de
provider e a extração do `ingest` são os primeiros passos e independem delas.
Travam apenas a fiação final do inbound e dois métodos do adapter.

| Pendência | Impacto |
|---|---|
| Path do **"Configurar Webhook da Instância"** (POST, grupo *Webhooks e SSE*) | Registro automático do webhook. O corpo é assumido igual ao de `/globalwebhook`, que compartilha o schema `Webhook`. |
| Schema **`WebhookEvent`** (formato do evento de entrada) | Normalizador do inbound UAZAPI |
| **"Enviar menu interativo"** | `sendInteractiveButtons` / `sendInteractiveList` |
| **"Enviar reação a uma mensagem"** | `sendReaction` |

## 12. Referências UAZAPI confirmadas

Base: `https://<subdomínio>.uazapi.com`. Autenticação: header `token` (token da
instância). Endpoints administrativos usam `admintoken` — **não usados aqui**.

- `POST /instance/connect` — sem `phone` gera QR; com `phone` gera código de
  pareamento. Timeout de 2min (QR) / 5min (pareamento).
- `GET /instance/status` — estados: `disconnected`, `connecting`, `connected`,
  `hibernated`. Devolve `qrcode` atualizado durante a conexão.
- `POST /send/text` — `{ number, text, replyid, mentions, delay, forward,
  track_source, track_id, async, linkPreview* }`.
- `POST /send/media` — `{ number, type, file, text, docName, thumbnail,
  mimetype, viewOnce, … }`. Tipos: `image`, `video`, `videoplay`, `document`,
  `audio`, `myaudio`, `ptt`, `ptv`, `sticker`.
- `POST /globalwebhook` — schema `Webhook`: `{ url, events, excludeMessages,
  addUrlEvents, addUrlTypesMessages }`.
  - Eventos: `connection`, `history`, `messages`, `messages_update`, `call`,
    `contacts`, `presence`, `groups`, `labels`, `chats`, `chat_labels`,
    `blocks`, `sender`.
  - Filtros: `wasSentByApi`, `wasNotSentByApi`, `fromMeYes`, `fromMeNo`,
    `isGroupYes`, `isGroupNo`.

# Editar e apagar mensagens enviadas pelo CRM

**Data:** 2026-09-10
**Status:** aprovado, pronto para plano de implementação
**Origem:** pedido do usuário, junto com o ajuste de cores de status
(spec irmã, já implementada) — "editar mensagens já enviadas" e "apagar
mensagens... mantendo o conteúdo no banco de dados".

## 1. Objetivo

Deixar o atendente editar ou apagar, direto pelo CRM, uma mensagem de
texto que **ele mesmo enviou** — replicando o "Editar mensagem" e
"Apagar para todos" que o WhatsApp já oferece nativamente. Apagar nunca
remove a linha do banco: `content_text` continua intacto, e é a UI que
decide mostrar um placeholder no lugar.

## 2. Escopo — o que fica de fora, de propósito

- **Mensagem do cliente nunca é editável nem apagável por aqui** — nem
  pela UI, nem pela API. Decisão explícita do usuário (2026-09-10),
  e também um limite real do WhatsApp: só quem enviou pode editar ou
  apagar-para-todos.
- **Só mensagens de texto simples** (`content_type = 'text'`) podem ser
  editadas. Legenda de mídia fica de fora — a documentação da uazapi só
  confirma edição de texto puro, e prometer legenda sem testar seria
  chute.
- **Apagar** vale para qualquer `content_type` (texto, mídia, etc.) —
  o endpoint da uazapi não distingue.
- **Só canais uazapi.** A API do WhatsApp Cloud (Meta) não expõe editar
  nem apagar mensagem enviada — são recursos do WhatsApp Business
  App/uazapi, sem equivalente na Cloud API. Em conversas de canal Meta,
  os botões de editar/apagar simplesmente não aparecem.
- **Nenhum histórico multi-revisão.** Editar guarda só o texto de antes
  da *primeira* edição (auditoria interna), não uma lista de todas as
  versões — ninguém pediu ver revisão a revisão.
- **Sem prazo hardcoded na UI.** O WhatsApp impõe uma janela de tempo
  para editar/apagar, mas o valor exato não é documentado pela uazapi e
  muda por versão do app. Em vez de adivinhar um número e travar o
  botão antes da hora, deixamos a chamada seguir sempre; se o WhatsApp
  recusar por estar fora do prazo, o erro dele vira o texto do toast.

## 3. Situação atual (verificada em código)

- `messages` (schema em `20250101000001_initial_schema.sql`, com colunas
  adicionadas depois) tem `content_text`, `content_type`, `message_id`
  (o ID que a uazapi devolveu no envio, **sem** prefixo `owner:`),
  `sender_type` (`customer | agent | bot`) — nada de `deleted_at` ou
  `edited_at` hoje.
- `src/lib/whatsapp/providers/types.ts` define o contrato
  `WhatsAppProvider` que `uazapi.ts` e `meta.ts` implementam; recusa de
  capacidade já tem um padrão pronto, `ProviderUnsupportedError`, usado
  por `meta.ts` em `listGroups`/`leaveGroup`/etc.
- `docs/reference/uazapi-openapi.json` (recuperado nesta sessão) documenta
  os dois endpoints que este recurso precisa:
  - `POST /message/delete` — `{id}`. "Apaga mensagens em conversas
    individuais ou grupos... funciona com mensagens enviadas pelo
    usuário ou recebidas" (a permissão real de quem pode apagar o quê é
    o WhatsApp que impõe, não a uazapi — por isso o escopo desta spec já
    se limita à mensagem própria). Marca o status da mensagem como
    `"Deleted"` e dispara um webhook `messages_update` (não usado aqui —
    agimos direto na resposta síncrona da chamada, não esperamos o
    webhook).
  - `POST /message/edit` — `{id, text}`. "Só é possível editar mensagens
    enviadas pela própria instância"; "deve estar dentro do prazo
    permitido pelo WhatsApp para edição" (sem número exato). Devolve o
    objeto da mensagem atualizada.
  - O ID aceito é `owner:messageid` OU só `messageid` — o que já
    guardamos em `messages.message_id` funciona sem transformação,
    confirmado pelo padrão já usado em `sendReaction`
    (`args.targetMessageId` vai direto, sem prefixo).
- `src/app/api/whatsapp/react/route.ts` é o modelo mais próximo de rota
  de ação-numa-mensagem-existente: autentica → resolve `account_id` do
  perfil → lê a mensagem e confirma que a conversa é da conta → resolve
  o provider da conversa → chama o provider → só então grava no banco.
  As rotas novas seguem este mesmo esqueleto.
- `src/components/inbox/message-actions.tsx` já é a barra de
  hover/long-press da bolha (responder, reagir, copiar) — os botões
  novos entram aqui.
- `message-thread.tsx:312` e `:1012` já fazem `channel?.provider ===
  "uazapi"` para ligar/desligar recursos exclusivos do provedor — mesmo
  padrão usado para esconder editar/apagar em canal Meta.

## 4. Modelo de dados

Nova migration em `messages`:

```sql
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS original_content_text TEXT;
```

- `deleted_at` não nulo = apagada. **`content_text` nunca é limpo nem
  sobrescrito** — a UI troca a exibição por um placeholder quando
  `deleted_at` existe, mas o dado continua no banco (é literalmente o
  requisito original do usuário: "manter o conteúdo no banco de dados e
  apagar somente no front").
- `edited_at` não nulo = editada. `content_text` passa a ser sempre o
  texto **atual**; `original_content_text` é preenchido **só na
  primeira edição** (se já tiver valor, uma segunda edição não o
  sobrescreve) — guarda o texto de antes de qualquer edição, para
  auditoria interna, nunca exibido ao cliente nem ao atendente na
  thread normal.
- Uma mensagem pode estar editada e depois apagada (as duas colunas são
  independentes) — nesse caso o placeholder de apagada tem prioridade
  na exibição.
- Índices: nenhum necessário além dos que já existem — estas colunas só
  são lidas junto com a linha da mensagem, nunca filtradas em massa.

## 5. Camada de provedor

`src/lib/whatsapp/providers/types.ts` — dois métodos novos no contrato
`WhatsAppProvider`:

```ts
editMessage(args: { messageId: string; text: string }): Promise<void>;
deleteMessage(args: { messageId: string }): Promise<void>;
```

`uazapi.ts`:

```ts
async editMessage(args) {
  await client.post("/message/edit", { id: args.messageId, text: args.text });
},
async deleteMessage(args) {
  await client.post("/message/delete", { id: args.messageId });
},
```

`meta.ts` — as duas lançam `ProviderUnsupportedError("meta", "editMessage" | "deleteMessage")`,
mesmo padrão das capacidades de grupo.

`fake.ts` (test double) ganha as duas também, com o mesmo estilo dos
métodos de envio existentes (registra a chamada, devolve sucesso por
padrão, configurável para simular erro nos testes).

## 6. Rotas

Duas rotas novas, mesmo esqueleto de `POST /api/whatsapp/react`:

### `POST /api/whatsapp/messages/[id]/edit`

Body: `{ text: string }`.

1. Autentica (`supabase.auth.getUser()`), 401 se não logado.
2. Resolve `account_id` do perfil, 403 se não vinculado.
3. Busca a mensagem por `id` (UUID interno); 404 se não existir.
4. **Checa elegibilidade**, nesta ordem, 400 com mensagem clara em cada
   recusa:
   - `sender_type` precisa ser `'agent'` ou `'bot'` — nunca `'customer'`.
   - `content_type` precisa ser `'text'`.
   - `deleted_at` precisa ser nulo (não dá para editar o que já foi
     apagado).
   - `message_id` (o ID da uazapi) precisa existir — mensagem que falhou
     no envio não tem o que editar no WhatsApp.
5. **Checa permissão**: quem faz a chamada precisa ser o autor original
   (`sender_id = user.id`) OU ter papel `admin`/`owner` na conta — 403
   caso contrário. (Decisão do usuário: "autor apaga a sua, admin apaga
   qualquer", aplicada aqui também para editar.)
6. Resolve a conversa (confirma `account_id` bate) e o provider da
   conversa (`getProviderForConversation`); se o canal não for uazapi,
   404/400 — a UI já não mostra o botão neste caso, então chegar aqui é
   sinal de chamada direta indevida.
7. Chama `provider.editMessage({ messageId: message.message_id, text })`.
   Erro do provider (inclui "fora do prazo") vira 502 com a mensagem
   original do WhatsApp repassada.
8. Só então grava no banco: `content_text = text`, `edited_at = now()`,
   `original_content_text = original_content_text ?? <texto anterior>`
   (preenche só se ainda nulo).
9. Devolve a mensagem atualizada.

### `POST /api/whatsapp/messages/[id]/delete`

Sem body.

1–3. Iguais à rota de editar.
4. Checa elegibilidade: `sender_type` agent/bot, `deleted_at` nulo,
   `message_id` existente.
5. Checa permissão: mesma regra (autor ou admin/owner).
6. Resolve conversa + provider; canal não-uazapi → 400.
7. Chama `provider.deleteMessage({ messageId: message.message_id })`.
   Erro do provider → 502.
8. Grava `deleted_at = now()`, `deleted_by = user.id`. **`content_text`
   não é tocado.**
9. Devolve sucesso.

## 7. Interface

Em `message-actions.tsx`, dois botões novos na barra de hover/long-press,
visíveis só quando `channel?.provider === "uazapi"` **e**
`message.sender_type` é `agent`/`bot` **e** (autor da mensagem OU
`canEditSettings`/admin):

- **Lápis** (editar) — só aparece se `message.content_type === "text"` e
  `!message.deleted_at`. Ao clicar, o composer é preenchido com o texto
  atual da mensagem e entra em "modo edição" (rótulo indicando que é uma
  edição, botão de cancelar); enviar chama a rota de editar em vez de
  mandar mensagem nova.
- **Lixeira** (apagar) — aparece sempre que `!message.deleted_at`.
  Confirma com um diálogo simples antes de chamar a rota (ação
  irreversível pro cliente, mesmo mantendo o dado no nosso banco).

Renderização da bolha (`message-bubble.tsx`):

- `deleted_at` não nulo → em vez do conteúdo normal, mostra um
  placeholder cinza/itálico: "Mensagem apagada" (chave de tradução
  nova). Nenhum outro dado da mensagem (mídia, texto) é exibido.
- `edited_at` não nulo e `!deleted_at` → mostra "(editado)" pequeno ao
  lado do horário, mesmo lugar visual que o WhatsApp usa.
- `reply-quote.tsx` (preview de mensagem citada): se a mensagem citada
  tem `deleted_at` preenchido, o preview também mostra "Mensagem
  apagada" em vez do texto original — mesmo comportamento do WhatsApp
  real, consistente com a bolha.

## 8. Erros e mensagens

Todo erro do provider (uazapi recusou por prazo, mensagem não encontrada
do lado deles, etc.) chega como `502` com o texto original repassado —
a UI mostra isso direto num toast, sem reescrever. Erros de elegibilidade
(400) e permissão (403) têm mensagens fixas e claras, sem expor detalhe
interno.

## 9. Testes

Seguindo TDD, RED→GREEN real, mesmo padrão desta sessão:

- `types.ts`/`uazapi.ts`/`meta.ts`/`fake.ts`: teste unitário de cada
  método novo (uazapi chama o endpoint certo com o payload certo; meta
  lança `ProviderUnsupportedError`).
- Rotas: teste por cenário — 401 sem sessão, 403 sem conta, 404 mensagem
  não encontrada, 400 mensagem de cliente / tipo errado / já apagada /
  sem `message_id`, 403 não-autor-nem-admin, 502 erro do provider
  repassado, 200 caminho feliz com a gravação certa no banco (usar o
  padrão de spy real em `.eq()`/`.update()` já estabelecido nesta sessão
  — nunca um stub que ignora argumentos).
- `message-actions.tsx`/`message-bubble.tsx`: teste de que os botões só
  aparecem nas condições certas (canal uazapi, mensagem própria,
  `content_type`/`deleted_at` corretos) e que o placeholder/badge
  "(editado)" renderiza como esperado.

## 10. Global Constraints (para o plano)

- Comentários e commits em português, seguindo a convenção já
  estabelecida no restante do código.
- TDD real: RED→GREEN observado antes de qualquer implementação.
- Nunca tocar `content_text` ao apagar — é o requisito central do
  usuário.
- `original_content_text` só é preenchido na primeira edição, nunca
  sobrescrito depois.
- Toda checagem de elegibilidade/permissão roda **antes** de chamar o
  provider — nunca gastar uma chamada real à uazapi para depois recusar
  no nosso lado.
- Nenhuma mudança em `meta.ts` além de lançar `ProviderUnsupportedError`
  — não há suporte real a implementar para o provedor Meta.

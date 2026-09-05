# Grupos de WhatsApp no CRM — Fase 3 (gestão de grupo)

**Data:** 2026-09-04
**Status:** proposto, aguardando revisão
**Escopo desta spec:** sair do grupo, adicionar/remover participante,
promover/rebaixar admin, renomear grupo.
**Depende de:** Fase 1 (`2026-08-28-grupos-whatsapp-fase1-design.md`) e
Fase 2 (`2026-09-03-grupos-whatsapp-fase2-design.md`), ambas entregues,
revisadas e **em produção** desde 2026-09-04.

---

## 1. Problema

A Fase 1 entregou leitura, a Fase 2 entregou envio. Falta a gestão do
grupo em si: hoje, se o operador quer que o número conectado saia de um
grupo, ou precisa adicionar/remover alguém, ou corrigir o nome do grupo,
não há nada no CRM para isso — a única forma é abrir o WhatsApp do
celular.

### O que já foi provado (não é suposição)

Investiguei ao vivo contra a instância uazapi de homologação
(`j7softwarehouse.uazapi.com`) os três endpoints relevantes, usando um
JID de grupo inexistente para não afetar dados reais (com uma exceção
documentada abaixo, que virou um incidente):

- **`POST /group/updateParticipants`** — corpo
  `{ groupjid, action, participants }`, onde `action` é uma de
  `"add"`, `"remove"`, `"promote"`, `"demote"` (confirmado: qualquer
  outro valor devolve `400 {"error":"Invalid action"}`) e
  `participants` é um array de telefones **sem `+` e sem o 9º dígito
  quando o número real não usa (confirmado com um número de teste
  real do grupo "Teste": `"553183839660"` — formato exatamente igual
  ao que `/group/list` já devolve em `PhoneNumber`, menos o sufixo
  `@s.whatsapp.net`)**.
  Com JID de grupo inexistente: `add`/`remove` devolvem
  `500 {"error":"...info query returned status 404: item-not-found"}`;
  `promote`/`demote` devolvem
  `500 {"error":"...info query returned status 403: forbidden"}` —
  ou seja, **este endpoint valida a existência do grupo e (para
  promote/demote) a permissão antes de agir**.
  **Descoberta importante sobre o formato da resposta de sucesso:**
  testei `action: "add"` com um telefone que já era participante do
  grupo real "Teste" (sem adicionar ninguém novo, sem efeito
  colateral) e a resposta veio `200`, mas o resultado real está
  aninhado — `{ group: {...}, groupUpdated: [{ JID, PhoneNumber,
  IsAdmin, Error, ... }], needs_refresh: boolean }`. O elemento de
  `groupUpdated` para o telefone testado veio com `Error: 409`
  (conflito — "já é participante"), não um erro de nível HTTP.
  **O status HTTP sozinho não diz se a ação teve efeito — é preciso
  ler `groupUpdated[].Error` (`0` = sucesso, qualquer outro valor =
  falha) por telefone.**
- **`POST /group/updateName`** — corpo `{ groupjid, name }`. Mesmo
  padrão: JID inexistente devolve
  `500 {"error":"...info query returned status 404: item-not-found"}`.
  Corpo vazio devolve `400 {"error":"Name cannot be empty"}`.
- **`POST /group/leave`** — corpo `{ groupjid }`.
  **Não valida nada.** Testado duas vezes: uma contra o grupo real de
  teste ("Teste", JID `120363429748080632@g.us`) e uma contra um JID
  inexistente — **as duas vezes devolveu `200 {"response":"Group leave
  successful"}`**. A primeira chamada, contra o grupo real, de fato
  desconectou o número conectado do grupo de teste (confirmado por uma
  consulta seguinte a `/group/list`, onde o grupo deixou de aparecer) —
  um incidente real durante esta investigação, revertido manualmente
  pelo usuário (readicionou o número e resincronizou). A conclusão
  fica registrada como decisão de design: **este endpoint não pode ser
  usado como fonte de verdade sobre se a saída realmente aconteceu.**

Também confirmado: `GET /group/list` (já usado pela Fase 1) devolve,
por grupo, um array `Participants` com `JID`, `PhoneNumber`, `IsAdmin`,
`IsSuperAdmin` — o suficiente para montar a tela de gestão sem
depender de nenhum endpoint novo de leitura.

### Onde está o trabalho

Tudo em código novo — três rotas de API novas, três métodos novos no
provider uazapi (inexistentes no provider Meta), uma coluna nova em
`whatsapp_groups`, e uma tela de gestão em Configurações → Grupos.

---

## 2. Decisões já tomadas

| Decisão | Escolha |
| --- | --- |
| UI quando o número não é admin do grupo | Esconde as ações de gestão de antemão (não mostra botão que sempre falharia) |
| "Sair do grupo" exige ser admin? | **Não** — no WhatsApp real, qualquer membro sai, admin ou não. Só remover/promover/rebaixar/renomear exigem admin |
| Estado da conversa após sair | Vira somente-leitura, some da lista de grupos habilitados — não é apagada |
| Fonte da lista de participantes na tela de gestão | Busca ao vivo em `/group/list` toda vez que a tela abre — nunca a tabela `group_participants` (que só registra quem já mandou mensagem) |
| Estrutura das rotas de API | Três rotas de propósito único (`leave`, `name`, `participants`), não uma rota genérica de "executar ação" — mesmo padrão do resto do projeto |
| Quem pode acionar estas rotas no CRM | Só admin da conta (`requireRole('admin')`), mesma trava do `POST /api/whatsapp/groups/sync` já existente |

---

## 3. Desenho

### 3.1 Provider — três métodos novos

`src/lib/whatsapp/providers/types.ts` — acrescenta ao `WhatsAppProvider`:

```ts
export interface UpdateGroupParticipantsArgs {
  groupJid: string;
  action: "add" | "remove" | "promote" | "demote";
  phone: string;
}

// ...

leaveGroup(groupJid: string): Promise<void>;
updateGroupParticipants(args: UpdateGroupParticipantsArgs): Promise<void>;
updateGroupName(groupJid: string, name: string): Promise<void>;
```

`src/lib/whatsapp/providers/uazapi.ts` — implementação real. Novo tipo
de resposta (schema real confirmado empiricamente, ver seção 1):

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

```ts
async leaveGroup(groupJid: string) {
  await client.post("/group/leave", { groupjid: groupJid });
  // Sem retorno útil — a UAZAPI responde "successful" mesmo se nada
  // mudou (confirmado empiricamente). O chamador confirma via
  // listGroups() antes de considerar a saída bem-sucedida.
},

async updateGroupParticipants({ groupJid, action, phone }) {
  const result = await client.post<UazapiUpdateParticipantsResponse>(
    "/group/updateParticipants",
    { groupjid: groupJid, action, participants: [phone] },
  );
  // HTTP 200 não significa sucesso — confirmado empiricamente (ver
  // spec §1): o resultado real vem aninhado por telefone. Só um
  // telefone foi enviado, mas casa por PhoneNumber em vez de pegar o
  // primeiro item às cegas — mais robusto a qualquer reordenação.
  const entry = result.groupUpdated?.find((p) =>
    p.PhoneNumber?.startsWith(phone),
  );
  if (!entry || entry.Error !== 0) {
    throw new Error(
      `uazapi recusou a ação "${action}" para ${phone} (Error: ${entry?.Error ?? "ausente"})`,
    );
  }
},

async updateGroupName(groupJid: string, name: string) {
  await client.post("/group/updateName", { groupjid: groupJid, name });
},
```

`src/lib/whatsapp/providers/meta.ts` — os três métodos, cada um:

```ts
async leaveGroup() {
  throw new ProviderUnsupportedError("meta", "leaveGroup");
},
async updateGroupParticipants() {
  throw new ProviderUnsupportedError("meta", "updateGroupParticipants");
},
async updateGroupName() {
  throw new ProviderUnsupportedError("meta", "updateGroupName");
},
```

### 3.2 Migration — nova coluna

```sql
ALTER TABLE whatsapp_groups
  ADD COLUMN IF NOT EXISTS left_at TIMESTAMPTZ;
```

`left_at IS NOT NULL` significa "o número conectado saiu deste grupo
de verdade" — distinto de `enabled = false`, que significa "o usuário
desabilitou a exibição, mas ainda é membro" (o gap que a Fase 2 já
deixou registrado e que esta fase não resolve para o caso geral, só
para quem realmente saiu).

### 3.3 `POST /api/whatsapp/groups/[id]/leave`

1. `requireRole('admin')`.
2. Carrega `whatsapp_groups` por `id`, escopado por `account_id` — 404
   se não achar.
3. `provider.leaveGroup(group.group_jid)`.
4. Chama `provider.listGroups()` de novo e confirma que `group_jid` **não**
   está mais na lista. Se ainda estiver, devolve erro claro
   (`502`, "A uazapi respondeu sucesso mas o grupo continua na lista —
   tente novamente") em vez de fingir que funcionou.
5. Se confirmado: `UPDATE whatsapp_groups SET left_at = now(), enabled
   = false WHERE id = ...`.
6. Resposta `200 { left: true }`.

### 3.4 `GET` e `POST /api/whatsapp/groups/[id]/participants`

Um arquivo de rota só, com os dois métodos — mesmo padrão que
`/api/whatsapp/groups/route.ts` já usa (`GET` + `PATCH` juntos).

**`GET`** — busca ao vivo em `provider.listGroups()`, acha o grupo
pelo `group_jid` local, devolve `{ participants: [...], isConnectedNumberAdmin: boolean }`.
`isConnectedNumberAdmin` é calculado comparando `PhoneNumber` de cada
participante contra o número do canal conectado (`whatsapp_channels`
já guarda isso em algum formato — o plano de implementação confirma
o campo exato). Não exige admin para **ler** — qualquer membro da
conta pode ver a lista; só as ações de escrita exigem admin.

**`POST`** — corpo `{ action: "add" | "remove" | "promote" | "demote", phone: string }`.

1. `requireRole('admin')`.
2. Valida `action` contra os 4 valores e `phone` não-vazio — 400 claro
   antes de chamar a uazapi (a uazapi já valida `action`, mas dar o
   erro antes economiza uma chamada de rede e mantém a mensagem em
   português).
3. Carrega o grupo (404 se não achar ou `left_at` preenchido — não faz
   sentido gerenciar participante de um grupo que já saímos).
4. `provider.updateGroupParticipants({ groupJid, action, phone })`.
   Erros HTTP do provider (404 grupo sumiu, 403 sem permissão) sobem
   como erro HTTP claro — **não** um "sucesso" genérico.
5. **Mesmo com HTTP 200, o provider precisa checar o `Error` aninhado
   por telefone** (`groupUpdated[].Error`, confirmado empiricamente —
   ver seção 1): `0` é sucesso; qualquer outro valor (ex.: `409` já é
   participante) é falha e deve virar um `SendMessageError`-like erro
   claro da rota, nunca um sucesso silencioso. `provider.updateGroupParticipants`
   já resolve isso internamente e lança se `Error !== 0`, para a rota
   não precisar conhecer o formato bruto da uazapi.
6. Chama `provider.listGroups()` de novo, confirma que o `Participants`
   do grupo reflete a mudança esperada (telefone presente/ausente,
   `IsAdmin` mudou) antes de devolver sucesso — defesa em profundidade
   adicional, mesmo já checando o `Error` aninhado no passo 5.
7. Resposta `200 { participants: [...] }` — a lista atualizada, para a
   UI não precisar de uma segunda chamada.

### 3.5 `POST /api/whatsapp/groups/[id]/name`

Corpo: `{ name: string }`.

1. `requireRole('admin')`.
2. Valida `name` não-vazio (trim) — 400 antes de chamar a uazapi.
3. Carrega o grupo (404 se não achar ou `left_at` preenchido).
4. `provider.updateGroupName(group.group_jid, name)`.
5. Em caso de sucesso: `UPDATE whatsapp_groups SET name = $1 WHERE id
   = $2` — otimista, não espera o próximo sync.
6. Resposta `200 { name }`.

### 3.6 `sendMessageToConversation` — bloqueio para grupo que saiu

Em `src/lib/whatsapp/send-message.ts`, dentro do ramo
`isGroupConversation`, logo após o guard de interativo/template
(Fase 2), acrescenta:

```ts
if (group?.left_at) {
  throw new SendMessageError(
    'bad_request',
    'You have left this group; sending is no longer possible',
    400
  );
}
```

Em `send-message.ts`, a query da conversa (`.select('*, contact:contacts(*), group:whatsapp_groups(id, group_jid)')`,
introduzida na Fase 2) precisa embutir `left_at` também:
`group:whatsapp_groups(id, group_jid, left_at)`.

### 3.7 UI — Configurações → Grupos

Cada linha da lista (`groups-manager.tsx`) ganha um botão "Gerenciar"
(ícone de engrenagem ou similar) que abre um Dialog com:

- **Nome do grupo** — texto com botão de editar ao lado (só visível
  se `isConnectedNumberAdmin`, vindo da mesma resposta do `GET`
  acima). Editar abre um input inline + salvar, chama `POST .../name`.
- **Lista de participantes** — buscada via `GET
  /api/whatsapp/groups/[id]/participants` (seção 3.4) ao abrir o
  painel. Cada linha: telefone, badge "Admin" se `IsAdmin`, botão
  remover (se `isConnectedNumberAdmin`) e botão promover/rebaixar (se
  `isConnectedNumberAdmin`) — cada um com diálogo de confirmação.
- **Adicionar participante** — campo de telefone + botão, chama
  `POST .../participants` com `action: "add"`. Sem confirmação (ação
  reversível — dá pra remover depois).
- **Sair do grupo** — sempre visível (não exige admin), botão
  destrutivo com diálogo de confirmação forte ("Isso desconecta o
  número deste grupo. Não é possível desfazer pelo CRM — alguém
  precisaria te readicionar pelo WhatsApp.").

Grupos com `left_at` preenchido aparecem na lista com um badge "Você
saiu" e sem o toggle de habilitar/desabilitar (não faz sentido
reabilitar exibição de um grupo que não somos mais membro).

---

## 4. O que NÃO muda

Participante de grupo **nunca** vira `contact` — adicionar por
telefone não cria, não atualiza, não consulta a tabela `contacts` em
nenhum ponto. `shouldDispatchEngines` (Fase 1) permanece intocada;
nenhuma tarefa desta fase deve tocar `src/lib/whatsapp/inbound/ingest.ts`.
O gap já registrado da Fase 2 (`enabled = false` não bloqueia envio
para quem ainda é membro) **não é resolvido aqui** — só o caso
específico de `left_at` (saiu de verdade) ganha o bloqueio de envio.

---

## 5. Fora de escopo

- Adicionar/remover múltiplos participantes de uma vez (lote).
- Avatar do grupo (upload/troca).
- Criar grupo novo pelo CRM (só gerencia grupos que o número já é
  membro).
- Link de convite (gerar, ver, revogar).
- Configurações avançadas do grupo (quem pode postar, mensagens
  temporárias, aprovação de entrada).
- Gestão de grupo pela API pública (`/api/v1/...`) — só pela UI
  autenticada do CRM.

---

## 6. Riscos

| Risco | Mitigação |
| --- | --- |
| `/group/leave` sempre reporta sucesso mesmo sem efeito | Rota reconfirma via `listGroups()` antes de gravar `left_at`; nunca confia só na resposta da chamada |
| HTTP 200 de `updateParticipants` não significa sucesso — o resultado real vem aninhado em `groupUpdated[].Error` (confirmado empiricamente contra o grupo real, sem efeito colateral: testei `action: "add"` com um telefone já participante, veio `200` com `Error: 409`) | `provider.updateGroupParticipants` sempre confere `Error === 0` antes de resolver a Promise; a rota nunca reporta sucesso baseada só no status HTTP |
| Admin do número conectado pode mudar fora do CRM a qualquer momento (alguém rebaixa pelo celular) | UI busca status ao vivo toda vez que abre o painel; rota trata 403 da uazapi como erro claro, nunca assume sucesso |
| Ação em grupo que o número já não é membro (`left_at` preenchido) | As três rotas novas recusam com 404/400 se `left_at` estiver preenchido, antes de qualquer chamada à uazapi |

---

## 7. Critérios de aceite

1. Operador admin abre o painel de gestão de um grupo onde o número
   conectado é admin — vê nome, lista de participantes e todas as
   ações (exceto "Sair", que sempre aparece independente de admin).
2. Operador admin abre o painel de um grupo onde o número conectado
   **não** é admin — vê nome, lista de participantes, mas sem os
   botões de remover/promover/rebaixar/renomear (só "Sair").
3. "Sair do grupo" realmente remove o número do grupo no WhatsApp
   real, confirmado por uma nova consulta a `/group/list` (não só a
   resposta imediata da chamada).
4. Depois de sair, a conversa desse grupo vira somente-leitura no CRM
   (composer bloqueado) e o grupo some da lista de habilitados em
   Configurações, com badge "Você saiu".
5. Adicionar participante por telefone realmente adiciona a pessoa ao
   grupo real, confirmado na lista de participantes.
6. Remover participante realmente remove a pessoa do grupo real,
   confirmado na lista de participantes.
7. Promover/rebaixar participante realmente muda o status de admin no
   grupo real, confirmado na lista de participantes.
8. Renomear grupo atualiza o nome no WhatsApp real e reflete
   imediatamente no CRM, sem esperar sincronização manual.
9. Nenhuma dessas ações cria, atualiza ou apaga qualquer linha em
   `contacts`.
10. Um operador não-admin da conta não consegue acionar nenhuma das
    ações de escrita (`leave`, `POST .../participants`, `POST
    .../name`) — 403. Ele **consegue** ver a lista de participantes
    (`GET .../participants`), que não exige admin.

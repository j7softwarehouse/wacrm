# Grupos de WhatsApp no CRM — Fase 1 (fundação + leitura)

**Data:** 2026-08-28
**Status:** proposto, aguardando revisão
**Escopo desta spec:** apenas a Fase 1. Envio (Fase 2) e gestão de grupo
(Fase 3) têm specs próprias, escritas depois que esta for entregue.

---

## 1. Problema

O CRM não enxerga grupos de WhatsApp. Hoje isso não é uma lacuna
acidental — grupos são descartados **de propósito, em dois níveis**:

- `src/lib/whatsapp/uazapi/connection.ts` registra o webhook da
  instância com `excludeMessages: ["wasSentByApi", "isGroupYes"]`, então
  mensagem de grupo **nem chega** ao nosso endpoint.
- `src/lib/whatsapp/uazapi/normalize.ts` descarta com
  `if (d.isGroup === true) return null`, como defesa em profundidade.

Ligar grupos exige mexer nos dois pontos **e re-registrar a
configuração do webhook na instância** — mudar só o código não basta,
porque o filtro vive no servidor da uazapi.

### Por que não é só "remover o filtro"

O modelo de dados é estritamente 1:1:

- `conversations.contact_id` é `NOT NULL REFERENCES contacts(id)`
- `contacts.phone` é `NOT NULL`
- índice único `idx_conversations_account_contact_channel` sobre
  `(account_id, contact_id, channel_id)`

Um grupo não tem telefone: tem um JID (`...@g.us`) e N participantes.
E `messages.sender_type` só distingue `agent | customer | bot` — não há
onde registrar **qual participante** escreveu. Sem isso, uma conversa de
grupo vira uma pilha de balões sem autor.

---

## 2. Decisões já tomadas

| Decisão | Escolha |
| --- | --- |
| Alcance do projeto | Leitura → envio → gestão, em 3 fases |
| Quais grupos entram | Só os que o usuário selecionar |
| Participantes | **Não** viram contatos do CRM |
| Modelo de dados | Entidade própria (`whatsapp_groups`), não "contato especial" |

A alternativa rejeitada era representar o grupo como uma linha em
`contacts` com `phone` = JID e uma flag `is_group`. Entregaria mais
rápido, mas contaminaria a base de contatos, o funil, as tags e todo
dashboard que assume "contato = pessoa" — e brigaria com a decisão de
participantes não virarem contatos.

---

## 3. Modelo de dados

### 3.1 `whatsapp_groups`

```sql
CREATE TABLE whatsapp_groups (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id   UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  channel_id   UUID NOT NULL REFERENCES whatsapp_channels(id) ON DELETE CASCADE,
  group_jid    TEXT NOT NULL,               -- '...@g.us'
  name         TEXT,
  avatar_url   TEXT,
  -- Opt-in explícito: o número conectado costuma estar em grupos
  -- pessoais que não podem poluir a inbox. Só grupo com `enabled`
  -- verdadeiro gera conversa.
  enabled      BOOLEAN NOT NULL DEFAULT FALSE,
  synced_at    TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (account_id, channel_id, group_jid)
);
```

### 3.2 `group_participants`

Registro leve, deliberadamente **fora** de `contacts`:

```sql
CREATE TABLE group_participants (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  group_id        UUID NOT NULL REFERENCES whatsapp_groups(id) ON DELETE CASCADE,
  participant_jid TEXT NOT NULL,   -- pode ser @s.whatsapp.net OU @lid
  phone           TEXT,            -- nulo quando o JID é @lid
  display_name    TEXT,            -- pushName observado
  first_seen_at   TIMESTAMPTZ DEFAULT NOW(),
  last_seen_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (group_id, participant_jid)
);
```

Participantes são descobertos pelas mensagens que chegam, não por uma
sincronização de participantes — por isso não há campo de administrador
aqui: nada na Fase 1 o preencheria. Ele entra na Fase 3, junto da
gestão que de fato precisa dele.

`phone` é nulo por design. O WhatsApp entrega participantes cada vez
mais como `@lid` — identificador opaco, sem telefone — e o código já
lida com isso em `normalize.ts` (a ordem `sender_pn` → `chatid` →
`sender` existe justamente para não gravar um LID como se fosse
número). Em grupo, `chatid` é o JID **do grupo**, então essa cadeia de
fallback não serve: o participante tem que sair de `sender_pn`/`sender`
e, quando só houver LID, ficamos com `display_name` e nada de telefone.

### 3.3 Mudanças em `conversations`

```sql
ALTER TABLE conversations
  ALTER COLUMN contact_id DROP NOT NULL,
  ADD COLUMN group_id UUID REFERENCES whatsapp_groups(id) ON DELETE CASCADE,
  ADD CONSTRAINT conversations_contact_xor_group
    CHECK (num_nonnulls(contact_id, group_id) = 1);

CREATE UNIQUE INDEX idx_conversations_account_group_channel
  ON conversations (account_id, group_id, channel_id) NULLS NOT DISTINCT;
```

O `CHECK` é o que impede o estado ambíguo: toda conversa é **ou** 1:1
**ou** de grupo, nunca as duas nem nenhuma.

> **Risco principal desta fase.** Soltar o `NOT NULL` de `contact_id`
> afeta todo código que assume contato presente numa conversa. O
> levantamento dessas chamadas é tarefa explícita do plano de
> implementação, não detalhe deixado para a hora de codar.

### 3.4 Mudanças em `messages`

```sql
ALTER TABLE messages
  ADD COLUMN participant_id UUID REFERENCES group_participants(id) ON DELETE SET NULL;
```

Preenchido só em mensagem recebida de grupo. `sender_type` continua
`customer` nesse caso — quem fala não é da nossa equipe. Não se cria
valor novo no enum, para não quebrar consumidores existentes.

---

## 4. Fluxo de entrada (webhook)

1. **Reconfigurar a instância.** Remover `isGroupYes` de
   `excludeMessages` em `buildWebhookConfig` e **re-registrar** a
   config na uazapi. Sem o re-registro nada muda: o filtro é do lado
   do servidor.
   ⚠️ Cuidado documentado em `connection.test.ts`: `isGroupNo` remove
   conversas **individuais** — a nomenclatura é invertida e trocar os
   dois derruba o atendimento 1:1.

2. **Normalizar.** `normalize.ts` deixa de descartar grupo e passa a
   devolver, além do já existente, o JID do grupo e a identidade do
   participante. `NormalizedInbound` ganha um campo opcional:

   ```ts
   group?: {
     groupJid: string;
     participantJid: string;
     participantName?: string;
   };
   ```

   Ausente = mensagem 1:1, exatamente como hoje. Nada muda para o
   caminho existente.

3. **Resolver a conversa.** Novo caminho paralelo a
   `resolveConversationByPhone`: `resolveConversationByGroup`, que
   busca o `whatsapp_groups` pelo `(account_id, channel_id, group_jid)`.
   - Grupo **desconhecido**: cria a linha com `enabled = FALSE` e
     **descarta a mensagem**. Assim a tela de seleção descobre os
     grupos existentes sem que eles apareçam na inbox.
   - Grupo conhecido e `enabled = FALSE`: descarta.
   - Grupo `enabled = TRUE`: encontra ou cria a conversa e grava a
     mensagem, fazendo upsert do participante.

4. **Trava de automação (obrigatória).** Em `ingest.ts`, mensagem de
   grupo **não** dispara `dispatchInboundToFlows`,
   `runAutomationsForTrigger` nem a resposta automática de IA.

   Sem essa trava, o bot passa a responder dentro de grupos — inclusive
   grupos pessoais do número conectado. É a falha mais cara desta fase
   e a mais difícil de reverter, porque a mensagem indevida já foi
   entregue a terceiros. Merece teste dedicado, não só cuidado no
   código.

   `ingest.ts` é um ponto único de passagem para flows e automations, o
   que torna a trava barata e verificável em um só lugar.

---

## 5. Interface

### 5.1 Tela de seleção de grupos

Em Configurações → Canais, uma aba **Grupos**:

- lista o que houver em `whatsapp_groups` do canal, com nome e foto;
- um botão "Sincronizar" busca os grupos na uazapi e faz upsert;
- um toggle por grupo controla o `enabled`;
- estado vazio explica que grupos aparecem depois de sincronizar ou
  depois que alguém escrever neles.

### 5.2 Inbox

- Conversa de grupo aparece na lista com o nome e um indicador visual
  de grupo.
- Na thread, **toda** mensagem recebida estampa o autor
  (`display_name`, com fallback para o telefone e, por último, "Participante").
  A regra de exibir autor em toda mensagem já existe desde a entrega de
  identificação do operador; aqui ela se aplica ao participante.
- O composer fica **desabilitado** na Fase 1, com aviso de que envio
  chega na fase seguinte. Melhor um caminho explicitamente fechado do
  que um botão que falha.

---

## 6. Fora de escopo (Fase 1)

- Enviar mensagem em grupo (Fase 2)
- Adicionar/remover participante, renomear, sair (Fase 3)
- Promover participante a contato do CRM
- Grupo em automações, fluxos, broadcasts, IA ou métricas do dashboard
- Comunidades do WhatsApp

---

## 7. Riscos

| Risco | Mitigação |
| --- | --- |
| Bot responder dentro de grupo | Trava em `ingest.ts` com teste dedicado, antes de qualquer UI |
| `contact_id` nulo quebrar código existente | Levantar e tratar todos os call sites como tarefa explícita do plano |
| Participante só com `@lid`, sem telefone | `phone` nulo por design; exibir `display_name` |
| Volume de mídia de grupo estourar storage | Grupos entram só por opt-in; a retenção de 48h de vídeo já vale para tudo |
| Migration não aplicar sozinha | A integração Supabase→GitHub aponta para `main` (abandonada); aplicar à mão nos dois ambientes, bucket antes do código |

---

## 8. Critérios de aceite

1. Mensagem em grupo **não** habilitado não cria conversa nem aparece
   na inbox, mas o grupo passa a ser listado na tela de seleção.
2. Ao habilitar um grupo, mensagens seguintes aparecem na inbox com o
   autor identificado em cada balão.
3. Mensagem de grupo **nunca** dispara automação, fluxo ou resposta de
   IA — verificado por teste automatizado.
4. O atendimento 1:1 segue idêntico: nenhuma regressão em conversas
   existentes.
5. Nenhum participante de grupo aparece na base de contatos.

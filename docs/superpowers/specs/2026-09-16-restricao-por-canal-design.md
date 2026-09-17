# Restrição de acesso por canal WhatsApp — design

> Retoma o eixo de `channel_members` deixado em aberto em
> `2026-07-31-controle-acesso-design.md` e `2026-09-15-escopo-de-conversas-design.md`.
> A parte da spec de julho em que o `viewer` ganhava permissão de
> escrever continua **substituída**: `viewer` segue somente-leitura.
> Este documento é a versão atualizada e final do eixo "canal",
> reconciliada com o escopo de conversas já em produção.

## 1. Objetivo

A conta tem hoje 2+ canais WhatsApp conectados (ex.: um número geral da
secretaria e um número de outro setor). O cliente quer restringir um
atendente a só ver/responder conversas de um ou mais canais
específicos — análogo ao escopo de conversas por atribuição, mas no
nível de canal.

## 2. Relação com o escopo de conversas (2026-09-15)

São dois eixos **independentes e combináveis**, cada um com seu próprio
campo em `profiles`:

| Campo | Valores | Controla |
|---|---|---|
| `conversation_scope` | `all` \| `assigned` | Vê só conversas atribuídas a mim? |
| `channel_scope` (novo) | `all` \| `assigned` | Vê só conversas de canais que atendo? |

Um agente pode ter os dois em `assigned` ao mesmo tempo: só vê as
conversas atribuídas a ele **e** que pertencem a um canal que ele
atende. As duas checagens são `AND` — ambas as funções de RLS já
existentes (`can_see_conversation`, `can_write_conversation`,
`can_start_conversation`) recebem um parâmetro novo e passam a checar
os dois eixos internamente, na mesma função (não uma segunda função
separada — a RLS chama isso por linha, duplicar a chamada dobraria o
custo de listar a Inbox).

`channel_scope` aplica-se a `agent` **e** `viewer`, igual à spec de
julho. `admin`/`owner` sempre ignoram os dois eixos.

## 3. Modelo de dados

```sql
ALTER TABLE profiles
  ADD COLUMN channel_scope TEXT NOT NULL DEFAULT 'all'
  CHECK (channel_scope IN ('all', 'assigned'));

CREATE TABLE channel_members (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  channel_id  UUID NOT NULL REFERENCES whatsapp_channels(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (channel_id, user_id)
);
```

Padrão `all`: nenhum usuário existente muda de comportamento e
**nenhuma migração de preenchimento é necessária** — diferença
deliberada da spec de julho, que exigia popular `channel_members` para
não cegar a conta inteira no dia do deploy (porque lá a presença na
tabela É a permissão; aqui a tabela só é consultada quando
`channel_scope = 'assigned'`).

Sem `account_id` denormalizado em `channel_members` — a tenancy é
verificada via `whatsapp_channels.account_id`, mesmo padrão de
`contact_tags`.

## 4. Funções de RLS — assinatura estendida

`can_see_conversation`, `can_write_conversation` e
`can_start_conversation` ganham um parâmetro `target_channel_id UUID`.

```sql
CREATE OR REPLACE FUNCTION can_see_conversation(
  target_account_id UUID,
  assigned UUID,
  target_channel_id UUID
) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM profiles p
    WHERE p.user_id = auth.uid()
      AND p.account_id = target_account_id
      AND (
        p.account_role IN ('admin', 'owner')
        OR p.conversation_scope = 'all'
        OR assigned = auth.uid()
      )
      AND (
        p.account_role IN ('admin', 'owner')
        -- 'all' cobre os dois casos de "não restrito por canal" de uma
        -- vez, canal removido incluso (target_channel_id nulo não
        -- precisa de tratamento especial aqui). Um usuário restrito
        -- ('assigned') cai direto no EXISTS abaixo, que nunca casa
        -- contra channel_id nulo — é assim que uma órfã fica invisível
        -- pra quem nunca atendeu aquele canal. Ver seção 5.
        OR p.channel_scope = 'all'
        OR EXISTS (
          SELECT 1 FROM channel_members cm
          WHERE cm.channel_id = target_channel_id AND cm.user_id = auth.uid()
        )
      )
  );
$$;
```

`can_write_conversation` ganha a mesma cláusula de canal, mantendo sua
checagem de papel ≥ agent. `can_start_conversation` também recebe
`target_channel_id` (ver seção 6 — precisa saber POR QUAL canal a
conversa nasceria, não só se a conta permite).

Toda chamada existente às três funções (políticas de `conversations`,
`messages` e `message_markers`) passa a incluir o canal da conversa —
**mesma migração**, para não deixar políticas inconsistentes entre si
no meio da aplicação.

## 5. Canal removido não deve ampliar acesso

Um canal removido (`whatsapp_channels` deletado) zera
`conversations.channel_id` via `ON DELETE SET NULL` nas conversas que
pertenciam a ele. Se `target_channel_id IS NULL` sempre liberasse o
acesso, um usuário restrito por canal passaria a enxergar todo o
histórico de um canal removido que nunca atendeu — abrindo acesso, não
preservando o que já existia.

A regra correta: a checagem de canal não trata `NULL` como caso
especial — só existem os dois ramos normais, `channel_scope = 'all'`
(sempre libera) ou o `EXISTS` contra `channel_members` (que por
definição nunca casa contra `channel_id` nulo). Resultado: um usuário
sem restrição de canal continua vendo órfãs normalmente (nada muda
para ele, cai no primeiro ramo); um usuário restrito nunca ganha acesso
a uma órfã, porque nenhuma linha de `channel_members` tem
`channel_id IS NULL` pra casar.

## 6. Início de conversa e a lista de canais

Hoje `GET /api/whatsapp/channels` devolve todos os canais da conta sem
filtro por usuário (`src/app/api/whatsapp/channels/route.ts`), e o
seletor de canal do botão "Conversar"
(`src/components/contacts/conversar-button.tsx`) lista todos eles. Com
`channel_scope = 'assigned'`, isso vazaria nome/número dos canais que a
pessoa não atende, e permitiria iniciar conversa por um canal fora do
seu escopo (a política de INSERT bloquearia a gravação, mas o dano de
vazar a lista já teria ocorrido).

`GET /api/whatsapp/channels` passa a filtrar pelo mesmo par de campos
(`channel_scope`/`channel_members`) antes de devolver a lista, para
`agent`/`viewer` restritos. `admin`/`owner` e usuários com
`channel_scope = 'all'` continuam vendo todos os canais, sem mudança.

`can_start_conversation(target_account_id, target_channel_id)` passa a
receber o canal escolhido e recusa se ele estiver fora do escopo do
usuário — mesmo com a lista já filtrada na origem, a política no banco
é a barreira real (a API é só a camada que evita expor a lista errada).

## 7. Trava de troca de canal

O gatilho `guard_conversation_assignment` (que já impede um usuário com
`conversation_scope = 'assigned'` de mudar `assigned_agent_id`) ganha a
mesma checagem para `channel_id`: um usuário com `channel_scope =
'assigned'` não pode mudar o canal de uma conversa existente. Sem isso,
a política de UPDATE libera a linha inteira e nada impediria escapar da
restrição reatribuindo o canal.

Renomear o gatilho não é necessário — só estender a condição que já
existe (`NEW.assigned_agent_id IS DISTINCT FROM OLD...` vira uma
checagem em duas colunas, cada uma com seu próprio eixo de escopo).

## 8. RPC de atribuição

`set_member_channel_scope(p_user_id, p_scope)` — cópia exata do padrão
de segurança de `set_member_conversation_scope` (admin+, mesma conta,
nunca o próprio usuário, recusa em admin/owner).

`set_member_channels(p_user_id, p_channel_ids UUID[])` — substitui a
lista completa de `channel_members` daquele usuário pelos ids
informados (mesmas checagens de segurança). Substituir a lista inteira
em vez de adicionar/remover um por um evita duas chamadas de rede por
clique de checkbox na tela de Membros.

## 9. UI — tela de Membros da equipe

Ao lado do seletor de escopo de conversa (`Todas as conversas` / `Só
as atribuídas`), um segundo seletor de mesmo estilo: `Todos os canais`
/ `Só alguns`. Quando `Só alguns` está selecionado, aparece uma lista
de checkboxes com os canais da conta (rótulo + número, mesmo formato
já usado em `conversar-button.tsx`).

Mesma visibilidade condicional do seletor de escopo: só aparece pra
linhas `agent`/`viewer`, nunca para `admin`/`owner`/o próprio usuário.

## 10. Estado vazio — usuário restrito sem canal

Um usuário com `channel_scope = 'assigned'` e zero canais atribuídos
veria uma Inbox vazia indistinguível de "não há conversas". A Caixa de
entrada precisa de um estado vazio específico para esse caso —
"Você ainda não foi atribuído a nenhum canal. Peça a um administrador."
— distinto do estado vazio genérico de lista sem resultados.

Detecção: `hasRestrictedScope` (channel) verdadeiro e a lista de
conversas carregada vier vazia E a conta tiver mais de zero canais no
total (para não confundir com uma conta genuinamente sem nenhuma
conversa ainda).

## 11. O que NÃO muda

- `conversation_scope` e sua UI, intocados — só ganham o parâmetro
  extra nas chamadas de função.
- `viewer` continua somente-leitura. Esta spec não reabre a decisão de
  2026-09-15.
- Broadcasts/templates continuam resolvendo canal por
  `resolveDefaultChannelId()` (canal mais antigo da conta) — isso é
  sobre QUAL canal a conta usa pra disparar, não sobre QUEM pode ver o
  quê. Fora de escopo aqui.
- Grupos de WhatsApp herdam `channel_id` como qualquer conversa — a
  regra de canal se aplica a eles automaticamente, sem código
  separado.

## 12. Ordem de implementação sugerida

| # | Tarefa | Por quê nessa ordem |
|---|---|---|
| 1 | `channel_scope` + `channel_members` + funções de RLS estendidas (conversations/messages/message_markers) na mesma migração | Base — nada funciona sem isso, e dividir entre migrações deixaria políticas inconsistentes no meio |
| 2 | Gatilho de trava de canal | Fecha o buraco de escapar da restrição via UPDATE, antes de expor qualquer UI |
| 3 | RPCs `set_member_channel_scope` / `set_member_channels` | Necessário antes da UI da tela de Membros existir |
| 4 | Filtro em `GET /api/whatsapp/channels` + `can_start_conversation` com canal | Fecha o vazamento de lista e o início de conversa fora de escopo |
| 5 | UI da tela de Membros (seletor + checkboxes de canal) | Sem isso, admin não consegue configurar nada |
| 6 | Estado vazio da Inbox pra usuário sem canal | Cosmético, mas evita parecer sistema quebrado |

## 13. Critérios de aceitação

- Usuário com `channel_scope = 'assigned'` e atribuído ao canal A vê e
  responde conversas do canal A; não vê nenhuma do canal B na lista.
- O mesmo usuário não consegue iniciar conversa nova por um canal fora
  do seu escopo (nem vê esse canal na lista do botão "Conversar").
- O mesmo usuário não consegue mudar o canal de uma conversa existente
  (gatilho recusa).
- Uma conversa de canal removido (`channel_id` nulo) continua visível
  para quem tinha `channel_scope = 'all'`; **não** aparece para quem
  tem `channel_scope = 'assigned'` e nunca atendeu aquele canal.
- `admin`/`owner` veem todos os canais, sem nenhuma atribuição.
- Usuário restrito sem nenhum canal atribuído vê o estado vazio
  explicativo, não uma Inbox genérica vazia.
- Nenhum usuário existente muda de comportamento até um admin mexer no
  seletor dele (padrão `all` em tudo).
- `message_markers` respeita o mesmo filtro de canal que conversas —
  não dá pra marcar nem ver marcador de uma conversa fora do escopo.

## 14. Testes

- `src/lib/auth/conversation-scope.ts` (ou um novo
  `channel-scope.ts`, a decidir na hora de implementar, mas mantendo o
  espelhamento TS-puro das 3 funções SQL): casos combinando
  `conversation_scope` × `channel_scope` × papel × canal nulo —
  mínimo 12 combinações (2×2×2 eixos relevantes, mais admin/owner
  bypass).
- RPCs: mesmos cenários de rejeição já cobertos em
  `set_member_conversation_scope` (não-admin, conta diferente, alvo
  admin/owner, o próprio usuário).
- `GET /api/whatsapp/channels`: restrito vê só os seus canais; `all`/
  admin veem todos.

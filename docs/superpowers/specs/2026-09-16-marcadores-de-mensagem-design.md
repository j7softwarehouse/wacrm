# Marcadores de mensagem — "onde eu parei"

**Data:** 2026-09-16
**Status:** aprovado, pronto para plano de implementação
**Origem:** pedido do cliente — com vários usuários atendendo a mesma
conversa, um atendente trata um assunto ainda pendente, outra pessoa
entra pra tratar OUTRO assunto na mesma conversa, e o primeiro perde o
ponto onde estava.

## 1. Objetivo

Deixar qualquer atendente marcar uma mensagem específica como "estou
tratando isso", com um rótulo curto opcional do assunto, e voltar
direto a esse ponto depois — de dentro da conversa, ou de uma lista
pessoal que reúne marcadores de todas as conversas.

## 2. O que isto NÃO é

Não é atribuição de conversa (`assigned_agent_id`), que já existe e
continua servindo pra outra coisa: "quem é o responsável por esta
conversa". Múltiplas pessoas já podem responder o mesmo chat hoje —
isso nunca foi o problema. O marcador é sobre **retomar um ponto**,
não sobre **quem pode escrever**.

Também não é o modelo de "assuntos" (conversa dividida em sub-tópicos
com status e dono próprios) cogitado e descartado nesta mesma sessão:
o cliente confirmou que a confusão é entre atendentes, não do lado do
cliente, e o modelo de assuntos seria trabalho bem maior que o
problema pede.

## 3. Decisão

- Marcador = mensagem + quem marcou + rótulo curto opcional.
- Uma pessoa pode ter **vários** marcadores na mesma conversa (assuntos
  diferentes, mesmo chat).
- Visível a **toda a conta** — é isso que também avisa aos colegas "a
  Aline já está tratando isso daqui", sem precisar perguntar.
- Remover um marcador: **só quem marcou, ou admin+**. Evita apagar sem
  querer a referência de outra pessoa.
- Marcar a mesma mensagem de novo **edita** o rótulo, não empilha um
  segundo marcador (`UNIQUE (message_id, created_by)`).

## 4. Onde aparece

### 4.1 Dentro da conversa
- Ação **"Marcar"** na barra de ações da mensagem (junto de responder /
  encaminhar / copiar), com campo opcional para o rótulo.
- Chip no balão: **"Financeiro · Paulo"** (ou só "Paulo" sem rótulo).
  O "×" pra desmarcar só aparece pra quem marcou (e pra admin).
- Botão **"Marcadores (N)"** no cabeçalho da conversa — abre a lista
  dos marcadores DAQUELA conversa; clicar rola até a mensagem e
  destaca, reaproveitando o mecanismo de "achar e destacar" já
  construído para a busca dentro da conversa
  (`src/lib/inbox/message-search.ts`, `splitHighlight`).

### 4.2 Em Notificações
Decisão explícita do cliente: os marcadores ficam em **Notificações**,
não na Caixa de Entrada, porque essa tela já vai ser (spec
`2026-09-15-escopo-de-conversas-design.md`) o único lugar que um
usuário de escopo restrito enxerga — colocar os marcadores lá garante
que esse usuário também tenha sua fila pessoal.

- Duas abas: **Notificações** (o que já existe — atribuições) e
  **Meus marcadores** (o que é novo).
- "Meus marcadores" lista as pendências do usuário logado em TODAS as
  conversas, agrupadas por contato, mais recente primeiro.
- Clicar num marcador abre a conversa (mesmo link `?c=<id>` que a
  notificação de atribuição já usa) e já rola/destaca a mensagem.

### 4.3 Filtro na lista de conversas
Filtro **"Com meus marcadores"** junto dos que já existem
(Todos / Não lidas / Aberto / Pendente / Fechado) em
`conversation-list.tsx` — mostra só as conversas onde o usuário logado
tem pelo menos um marcador.

## 5. Banco

Tabela nova `message_markers`, aditiva — não altera nenhuma tabela
existente. Ver `supabase/migrations/20260916000001_message_markers.sql`
para o schema e as políticas completas.

Ponto de atenção registrado na própria migração: as políticas usam
`is_account_member` (o padrão estável de hoje), não
`can_see_conversation`/`can_write_conversation` do escopo de
conversas — aquela feature está pausada, não em produção. Quando for
promovida, as políticas de `message_markers` precisam ser atualizadas
na MESMA migração, senão um usuário de escopo restrito enxergaria
marcador de conversa que a regra nova diz que ele não deveria ver.

## 6. Ordem de implementação

1. Migração (schema + RLS + Realtime) → aplicar em homolog.
2. Funções puras + testes: agrupar marcadores por conversa/contato,
   decidir quem pode remover, montar o texto do chip.
3. Telas: ação "Marcar", chip no balão, painel "Marcadores (N)" no
   cabeçalho, aba "Meus marcadores" em Notificações, filtro na lista.
4. Traduções (pt/en/ko).
5. `tsc` + eslint + suíte completa → homolog → teste do usuário.
6. Produção (migração + deploy), só com confirmação explícita.

## 7. Como verificar (homolog)

- Marcar uma mensagem com rótulo; o chip aparece pro próprio usuário
  e, em tempo real, pra outra pessoa já com a conversa aberta.
- Marcar a mesma mensagem de novo só troca o rótulo, não duplica.
- "Marcadores (N)" no cabeçalho pula e destaca corretamente.
- "Meus marcadores" em Notificações lista de várias conversas
  diferentes, agrupado por contato; clicar abre a conversa certa.
- Filtro "Com meus marcadores" mostra só as conversas certas.
- Um agente sem ser o autor do marcador NÃO consegue removê-lo; admin
  consegue.

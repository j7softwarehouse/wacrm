# Escopo de conversas — papel e alcance como eixos separados

**Data:** 2026-09-15
**Status:** aprovado, pronto para plano de implementação
**Piloto:** Instituto Educacional Emanuel
**Origem:** pedido do cliente — "o visualizador não precisa ver a caixa de
entrada; ele responde apenas o que for atribuído a ele, chegando pelas
Notificações. O agente vê tudo, menos o espaço de trabalho das
Configurações."

## 1. Objetivo

Permitir que um membro da conta **responda apenas as conversas atribuídas a
ele**, sem enxergar o restante da caixa de entrada — e fazer isso sem
gastar o papel "Visualizador", que precisa continuar existindo como
observador puro para os clientes futuros da assinatura.

## 2. Por que não é um quinto nível

A hierarquia atual é ordinal: `owner (4) > admin (3) > agent (2) > viewer
(1)`, e o número não é decorativo — a função `is_account_member(conta,
nível_mínimo)` sustenta dezenas de políticas no banco. Numa escada
ordinal, quem está acima herda tudo de quem está abaixo.

O papel pedido não cabe nessa escada: ele **escreve mais** que o
visualizador, porém **enxerga menos**. Colocá-lo acima do visualizador lhe
daria visão de todas as conversas — exatamente o que se quer tirar.
Colocá-lo abaixo tiraria a escrita.

A conclusão é que existem **duas dimensões**, não uma escada mais longa:

- **Papel** — o que a pessoa pode fazer (ler, escrever, administrar).
- **Escopo de conversas** — sobre quais conversas aquilo vale.

## 3. Decisão

Mantêm-se os quatro papéis. Acrescenta-se ao membro um campo independente:

**Escopo de conversas: `Todas` (padrão) ou `Somente atribuídas a ele`.**

| Papel | Escopo | Resultado |
|---|---|---|
| Visualizador | Todas | Observador puro — vê tudo, nunca escreve (comportamento atual, preservado) |
| Visualizador | Somente atribuídas | Observador em treinamento — acompanha só o que é dele |
| Agente | Todas | Agente normal de hoje |
| **Agente** | **Somente atribuídas** | **O papel pedido** — vê e responde apenas o que lhe foi atribuído |
| Admin / Owner | Todas | Escopo não se aplica; visão sempre completa |

A pessoa que o cliente chamou de "visualizador" é, no modelo, um **agente
com escopo restrito**: a capacidade de responder vem do papel, o limite de
enxergar vem do escopo.

**Padrão `Todas`** significa que nenhum dos 12 usuários existentes em
produção (6 agentes, 4 admins, 2 owners — verificado em 2026-09-15) muda
de comportamento com a migração.

## 4. Relação com as specs anteriores

### 4.1 `2026-07-31-controle-acesso-design.md` (aprovada, nunca implementada)

Aquela spec resolve um problema vizinho por **outro eixo**: restringir o
operador aos **canais** (números de WhatsApp) que ele atende, via uma
tabela `channel_members` que **nunca foi criada** (verificado: nenhuma
migração e nenhuma referência em código).

Pontos em que esta spec a **substitui**:

- **Escrita do `viewer`** — a spec de julho fazia o próprio `viewer`
  passar a escrever, mantendo o nome. Aqui isso **não acontece**: o
  visualizador continua somente-leitura, e quem escreve com alcance
  reduzido é o agente com escopo restrito. Motivo: preservar o
  observador puro para revenda (decisão do cliente em 2026-09-15).
- **Escopo da caixa de entrada** — lá era por canal; aqui é por
  atribuição da conversa.
- **Menu do papel restrito** — lá o Dashboard era visível ao `viewer`
  (confirmado pelo cliente em 2026-07-31); aqui quem tem escopo restrito
  não vê Dashboard (decisão de 2026-09-15).

Ponto que **permanece em aberto e não é tocado aqui**: a atribuição por
canal (`channel_members`). Os dois eixos são compatíveis — um limita por
número atendido, o outro por conversa entregue — e o campo criado aqui não
impede que a atribuição por canal seja construída depois.

### 4.2 `2026-09-09-settings-role-gating-design.md`

Aquela spec deu ao `agent` acesso a todo o espaço de trabalho menos
WhatsApp e Grupos. Esta spec **estreita essa regra** — ver seção 7.

## 5. Onde a regra mora: no banco

A restrição precisa valer mesmo para quem digitar a URL de outra conversa
na mão ou chamar a rota pelo DevTools. Por isso ela vive na RLS, não na
interface:

- Coluna nova `profiles.conversation_scope`, padrão `all`.
- Duas funções auxiliares (`pode_ver_conversa`, `pode_escrever_conversa`)
  que combinam papel e escopo, no mesmo espírito de
  `is_account_member` — um só lugar para a regra, consultado por todas as
  políticas.
- Políticas reescritas em `conversations` e `messages`: quem tem escopo
  restrito só alcança linhas cujo `assigned_agent_id` é ele.
- **Criar conversa** continua exigindo escopo `all`: quem é restrito
  responde, não inicia. Isso também fecha o botão "Conversar" de Contatos
  pelo lado do banco, não só pela tela.
- **Gatilho de trava:** recusa alteração de `assigned_agent_id` feita por
  usuário de escopo restrito. Sem ele, a pessoa poderia se desatribuir
  (fazendo a conversa sumir da própria lista) ou repassá-la a outro.
- Revisar as tabelas satélite que dependem de conversa (reações, anexos no
  storage) para que não fiquem com brecha mais larga que a política
  principal.

## 6. Interface

- **Menu** ganha trava por papel/escopo — hoje não existe nenhuma: todos os
  papéis veem todos os itens, só os botões ficam desabilitados.
  Escopo restrito vê **Notificações, Contatos, Manual e Configurações**.
  Some: Caixa de entrada, Dashboard, Funil, Broadcasts, Automações, Fluxos,
  Agentes IA.
- **Entrada no sistema:** a raiz `/` hoje manda todo mundo para
  `/dashboard`. Para escopo restrito passa a mandar para `/notifications`,
  senão a pessoa cai numa tela que não pode ver logo ao entrar.
- **Como ele trabalha:** a notificação de atribuição — que já é criada por
  gatilho no banco (`on_conversation_assigned`), sem trabalho novo — abre a
  conversa diretamente. A lista ao redor já vem filtrada pela RLS.
- **Páginas escondidas ganham guarda:** tirar do menu não basta.
- **Tela de Membros da equipe:** seletor de escopo ao lado do papel,
  disponível para Visualizador e Agente; fixo em `Todas` para Admin/Owner.

## 7. Configurações — espaço de trabalho

Sobem de `agent` para `admin`: **WhatsApp, Grupos, Modelos, Negócios e
moeda, Membros da equipe, Chaves de API**.

Ficam acessíveis ao `agent`: **Respostas rápidas e Campos e tags** — são
ferramentas de atendimento do dia a dia, não administração (decisão do
cliente em 2026-09-15).

## 8. Ordem de implementação

| # | Etapa | Por quê primeiro |
|---|---|---|
| 1 | Migração: coluna, funções, políticas, gatilho | é o núcleo de segurança; tudo mais é consequência |
| 2 | Predicados de papel/escopo + testes | parte pura, trava o comportamento antes da tela |
| 3 | Menu, entrada no sistema, guardas de página | |
| 4 | Tela de Membros + Configurações | |
| 5 | Verificação manual em homolog, um usuário por combinação | RLS não se prova em teste unitário |

## 9. Como verificar (homolog, com usuários reais)

- Agente restrito **vê e responde** uma conversa atribuída a ele.
- Agente restrito **não vê** nenhuma conversa não atribuída a ele — nem
  pela lista, nem digitando a URL da conversa na mão.
- Agente restrito **não consegue** se desatribuir nem repassar a conversa.
- Agente restrito **não consegue** iniciar conversa nova pelo Contatos.
- Agente normal, admin e owner seguem enxergando tudo, sem diferença.
- Visualizador continua somente-leitura.
- O canal de atualizações ao vivo respeita a mesma regra: a lista do
  restrito não recebe evento de conversa alheia.

## 10. Riscos

- **A RLS é o ponto crítico.** Política errada esconde conversa de quem
  precisa ou expõe para quem não deve. Vai numa migração isolada e
  reversível, promovida só depois do teste em homolog com um usuário de
  cada combinação.
- **Tempo real** pode não respeitar RLS da mesma forma que a consulta
  comum; precisa ser verificado ao vivo, não presumido.

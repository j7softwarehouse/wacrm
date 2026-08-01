# Adaptação escolar — Fase 1

**Data:** 2026-07-31
**Status:** aprovado, pronto para plano de implementação
**Piloto:** Instituto Educacional Emanuel

## 1. Objetivo

O wacrm nasceu como CRM de vendas. O Instituto Educacional Emanuel o usa como canal
de comunicação escolar: captação de matrícula e atendimento a famílias. Esta fase
adapta a operação diária ao contexto de escola **sem bifurcar o código** — tudo que
é específico nasce como configuração por conta, para que o próximo cliente, de
qualquer ramo, rode o mesmo binário.

O uso real confirma o recorte. Amostra das conversas em produção (2026-07-29 a 31):

> *"E os uniformes"* · *"Já comprei os materiais solicitados"* · *"Neste valor está
> incluso alguma alimentação?"* · *"Pode ser uma vez só as matrículas no crédito"* ·
> *"Vou tentar ir aí na semana que vem"*

É funil de captação com atendimento a famílias — não venda B2B com proposta e
negociação.

## 2. Escopo

### Incluído

1. Autoria do operador na mensagem
2. Contatos: distinção novo × identificado
3. Importação em XLSX (e correção do CSV)
4. Abrir e baixar mídia recebida
5. Card de alerta: sem resposta há 30 min
6. Módulo de vendas configurável por conta

### Excluído

- **Hierarquia de acesso e atribuição por canal** — spec próprio
  (`2026-07-31-controle-acesso-design.md`), por ser mudança de modelo de segurança.
- **Modelo aluno × responsável** — a lista da escola codifica turma, relação e nome
  do aluno dentro do campo nome. Decisão consciente de importar cru nesta fase; a
  string inteira fica preservada, então extrair para tags depois não exige
  reimportação.
- **Grupos de WhatsApp** — parado a pedido do cliente desde 2026-07-27.
- **Feriados no cálculo de expediente** — só dias da semana nesta fase.

## 3. Autoria do operador na mensagem

### Problema

`messages.sender_id` existe desde a migração 001, mas **nunca é preenchido**:
`send-message.ts:420` grava `sender_type: 'agent'` e omite o autor. Verificado em
produção — todas as mensagens de agente têm `sender_id = null`, inclusive uma cujo
texto é literalmente *"teste usuário Paulo"*.

Consequência prática relatada pelo cliente: com mais de um operador na mesma
conversa, não há como saber onde termina o atendimento de um e começa o do outro.

**Este item é o mais urgente do spec** porque é o único cujo custo cresce com o
tempo: cada dia de uso acumula histórico sem autoria, e o dado não é recuperável
depois — nunca foi gravado.

### Gravação

`SendMessageParams` ganha `senderUserId?: string`, repassado ao insert. A rota de
envio do painel já conhece o usuário autenticado via `getCurrentAccount()`.

Nem todo envio tem humano por trás. A regra:

| Origem do envio | `sender_id` |
|---|---|
| Painel, usuário logado | id do usuário |
| Automação, fluxo, broadcast | `null` |
| API pública (chave de API) | `null` |
| Resposta automática de IA | `null` — já se distingue por `ai_generated = true` |

### Exibição

O balão de mensagem enviada mostra o nome do autor **apenas quando o operador
muda**, não em toda mensagem. Repetir o nome em cada balão polui a leitura;
marcar a troca é exatamente o que resolve a dor relatada.

Sem autor identificado o rótulo é "Sistema". Mensagens da IA continuam com o
indicador que já existe.

O nome vem de `profiles`, legível por qualquer membro da conta pela política
`profiles_select` já existente.

### Histórico

As mensagens já enviadas permanecem sem autoria. Não há inferência possível.

## 4. Contatos: novo × identificado

### Problema

A escola terá dois números: um geral (público, recebe conhecidos e desconhecidos)
e um interno (famílias matriculadas e equipe, todos na lista). A secretaria
precisa distinguir, no meio do atendimento, quem é família da casa e quem é
alguém novo chegando.

O tamanho do problema, medido na base real: dos 19 contatos hoje no CRM, apenas
**um** (Camilly, 553175963844) consta da lista de ~270 contatos da escola. Os
outros 18 são desconhecidos.

### Modelo

Nova coluna `contacts.source TEXT`:

| Valor | Significado |
|---|---|
| `import` | veio da lista da escola → identificado |
| `whatsapp` | criado automaticamente por mensagem recebida → novo |
| `manual` | cadastrado à mão na tela → identificado |

Default `whatsapp` para as linhas existentes, que é o que elas de fato são.

**Por que coluna e não tag:** tag é editável e some sem rastro; convive com as tags
de uso cotidiano (turma, assunto) e se perde no meio delas. Origem é fato sobre a
procedência do contato, não etiqueta.

### Interface

Badge "Novo" para `source = 'whatsapp'`, em dois lugares:

- **Lista de Contatos** — com filtro, para a secretaria varrer os não identificados
- **Painel do contato no Inbox** — onde ela mais precisa ver, durante o atendimento

Ao editar e nomear um contato novo, ele passa a `manual`.

### Independência do canal

A origem do contato não depende do canal por onde ele fala. Uma família da lista
que escreva no número geral continua aparecendo como identificada — que é o
comportamento correto.

## 5. Importação em XLSX

### Problema

A importação atual aceita só CSV, e o parser faz `.split(',')`
(`parse-contact-csv.ts:49`) sem tratar codificação. O Excel em português salva CSV
com **ponto e vírgula** e em Latin-1: o arquivo vira uma coluna só, o cabeçalho
`phone` não é encontrado e a importação falha inteira — quando não corrompe os
acentos de "Angélica", "Bárbara", "João".

Não é erro de uso: o parser é incompatível com o que o Excel brasileiro produz.

### Solução

Aceitar `.xlsx` além de CSV. O formato guarda texto em UTF-8 e não tem ambiguidade
de separador, eliminando de uma vez os dois problemas.

Junto: corrigir o parser de CSV para aceitar `;` como separador e detectar BOM /
codificação. São poucas linhas e evita que a próxima pessoa caia na mesma armadilha
silenciosa.

**Dependência a decidir na implementação.** O pacote `xlsx` do npm está
desatualizado e com vulnerabilidades conhecidas; a versão mantida do SheetJS saiu
do npm. A escolha da biblioteca será avaliada e apresentada antes de ser
introduzida — o sistema trata dado de menores e não deve ganhar dependência com
CVE conhecido.

### Dados da lista do piloto

A lista fornecida (PDF, ~270 contatos) precisa de tratamento antes da importação:

- 3 linhas sem nome, incluindo o próprio número da escola (`553189891123`)
- 1 linha inválida: "WhatsApp Business" com telefone `0`
- Formatos mistos de telefone (12 e 13 dígitos) — a deduplicação existente já
  tolera, comparando os últimos 8 dígitos, o que cobre o nono dígito brasileiro

Nomes entram crus, como decidido: `Amanda Mãe Luan Amaral Maternal` fica assim.

## 6. Abrir e baixar mídia recebida

### Problema

A imagem recebida aparece, mas não há como abrir nem baixar: o componente
`MediaImage` (`message-bubble.tsx:112-119`) renderiza um `<img>` sem clique, sem
link e sem download. Além disso usa `object-cover`, que **corta** a imagem — a foto
de teste (768×1376) aparece truncada num quadro de 240×256.

### Solução

- Clique na miniatura abre a mídia em tamanho real, sobreposta
- Botão de download explícito
- Miniatura passa a `object-contain`, preservando a proporção

Vale para imagem e vídeo. Documento já é link de download hoje.

## 7. Card de alerta — sem resposta há 30 min

Ocupa o lugar de "Valor de Negócios Abertos" no Dashboard.

### Regra

Conversa cuja última mensagem é do contato e que acumulou **mais de 30 minutos de
expediente** sem resposta da escola.

Expediente: segunda a sexta, 07:00–19:00.

O relógio **pausa** fora da janela. Mensagem de sexta às 18:50 conta 10 minutos na
sexta e volta a correr segunda às 07:00 — reflete o tempo de atendimento realmente
devido, não o tempo de calendário.

### Fuso horário — cuidado obrigatório

O cálculo usa `America/Sao_Paulo` **explicitamente**, e não pode herdar o fuso da
máquina.

Motivo concreto: `src/lib/dashboard/date-utils.ts` usa `setHours` / `getDay`, que
leem o fuso do ambiente. Os testes desse arquivo falham hoje justamente por isso —
esperam `mondayIndex(new Date("2026-05-18")) === 0` e recebem `6`, porque a string
é interpretada como meia-noite UTC e, em UTC−3, cai no domingo anterior. Na Vercel
o servidor roda em UTC; herdar essa base erraria a janela de expediente em 3 horas.

### Componente

Função pura `businessMinutesBetween(início, fim)`, que conta apenas minutos dentro
da janela. É onde mora toda a sutileza — virada de dia, fim de semana, horário de
verão — e nasce com teste próprio antes de ser usada em qualquer lugar.

### Comportamento fora do expediente

O card mostra estado neutro, não número alarmante. Às 22h de domingo não faz
sentido acusar demora de resposta.

## 8. Módulo de vendas configurável

### Modelo

Nova coluna `accounts.disabled_modules TEXT[]`, default `{}`, seguindo o precedente
de `profiles.beta_features` (migração 011).

É **opt-out**: por padrão tudo continua ligado, então nenhuma conta existente muda
de comportamento — requisito do modelo de N clientes sobre o mesmo código.

Para o piloto: `disabled_modules = {'sales'}`.

### Alcance do módulo `sales`

| Onde | O que é ocultado |
|---|---|
| Menu lateral | Pipelines |
| Rota `/pipelines` | **bloqueada**, não apenas oculta |
| Dashboard | card "Valor de Negócios Abertos", gráfico "Valor do Pipeline", ação "Novo Negócio" |
| Configurações | seção "Negócios e moeda" |

Bloquear a rota é obrigatório: esconder só o menu deixa qualquer um entrar pela
URL.

Nada é removido do código — Pipelines continua íntegro para o próximo cliente que
precise.

### Como se liga

Inicialmente por SQL, mesmo padrão do `beta_features`. Um controle na tela de
Configurações fica para quando a configuração deixar de ser feita pelo
desenvolvedor.

## 9. Ordem de implementação

| # | Item | Razão da posição |
|---|---|---|
| 1 | Autoria do operador | único cujo custo cresce a cada dia de uso |
| 2 | Contatos novo × identificado + XLSX | destrava a importação da lista da escola |
| 3 | Abrir/baixar mídia | correção de uso diário, barata |
| 4 | Card de alerta 30 min | valor operacional direto |
| 5 | Módulo de vendas | cosmético, sem urgência |

## 10. Critérios de aceitação

- Mensagem enviada pelo painel grava `sender_id`; o balão mostra o autor e marca a
  troca de operador na conversa
- Envio por automação, broadcast e API pública continua funcionando, com autor nulo
  e rótulo "Sistema"
- Contato criado por mensagem recebida nasce `whatsapp` e exibe badge "Novo" na
  lista e no Inbox; ao ser nomeado, deixa de exibir
- Arquivo `.xlsx` exportado do Excel em português importa sem perder acento
- Arquivo `.csv` salvo pelo Excel em português (separador `;`) importa corretamente
- Imagem recebida abre em tamanho real e pode ser baixada, sem corte na miniatura
- `businessMinutesBetween` passa em teste de virada de dia, fim de semana e
  intervalo inteiramente fora do expediente
- Card de alerta conta corretamente uma mensagem de sexta 18:50 apenas a partir de
  segunda 07:00
- Conta com `disabled_modules = {'sales'}` não exibe Pipelines no menu **e**
  responde bloqueio na rota `/pipelines`
- Conta sem `disabled_modules` continua com todo o comportamento atual

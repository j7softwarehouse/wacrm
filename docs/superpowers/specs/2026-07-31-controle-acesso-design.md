# Controle de acesso — hierarquia e atribuição por canal

**Data:** 2026-07-31
**Status:** aprovado, pronto para plano de implementação
**Piloto:** Instituto Educacional Emanuel

## 1. Objetivo

Ajustar a hierarquia de papéis ao funcionamento real de uma secretaria escolar e
introduzir um eixo de acesso que hoje não existe: **quais canais (números de
WhatsApp) cada operador atende**.

Isto vive em spec separado da adaptação escolar por ser mudança de modelo de
segurança: toca política de acesso em várias tabelas e cria uma relação nova. Erro
aqui é falha de segurança, não defeito de tela, e merece revisão própria.

## 2. Situação atual (verificada)

Hierarquia `owner (4) > admin (3) > agent (2) > viewer (1)`, implementada pela
função `is_account_member(account_id, min_role)` (migração 017). Cada nível inclui
o anterior.

| Papel | Escrita hoje |
|---|---|
| `viewer` | **nenhuma** — nenhuma política de escrita alcança o nível 1 |
| `agent` | contatos, conversas, mensagens, notas, negócios, broadcasts, automações, fluxos |
| `admin` | + tags, campos personalizados, canais WhatsApp, modelos, pipelines, membros, dados da conta |
| `owner` | + transferir a propriedade |

Não existe nenhum vínculo entre usuário e canal. Conversa se atribui a uma pessoa
(`conversations.assigned_agent_id`); canal, não.

## 3. Modelo desejado

| Papel | Acesso |
|---|---|
| `viewer` | Caixa de entrada, Notificações, Contatos — **e responder**, restrito aos canais atribuídos |
| `agent` | tudo, exceto o espaço de trabalho nas Configurações — restrito aos canais atribuídos |
| `admin` | tudo, **exceto transferir a propriedade** |
| `owner` | tudo |

### Deltas em relação ao que já existe

O `agent` já é quase exatamente o pedido — falta apenas criar/editar pipelines. O
`admin` difere do `owner` só na transferência. **O peso do trabalho está no
`viewer` e no novo eixo de canais.**

### Decisão registrada: admin não transfere propriedade

`/api/account/transfer-ownership` exige `requireRole("owner")` por decisão
deliberada — o comentário no código cita o modo de falha *"admin mexe no dropdown
de papel por engano"*. Mantido: admin ganha todo o resto, mas a transferência
continua exclusiva do owner. Sem isso, um admin poderia tomar a conta do
proprietário de forma difícil de reverter.

### Decisão registrada: o rótulo "Visualizador" permanece

Mesmo passando a escrever, o papel mantém o nome atual e o valor `viewer` no banco.

## 4. Atribuição operador ↔ canal

### Modelo

Nova tabela de junção:

```
channel_members
  id          UUID PK
  channel_id  UUID → whatsapp_channels(id) ON DELETE CASCADE
  user_id     UUID → auth.users(id)        ON DELETE CASCADE
  created_at  TIMESTAMPTZ
  UNIQUE (channel_id, user_id)
```

Sem `account_id` denormalizado: a tenancy é verificada através de
`whatsapp_channels`, seguindo o padrão já usado por `contact_tags` e
`message_reactions`.

### Regra de acesso

Função auxiliar, espelhando o padrão de `is_account_member`:

```
can_access_channel(target_channel_id) →
  admin ou superior na conta do canal            → verdadeiro
  membro de channel_members para aquele canal    → verdadeiro
  caso contrário                                 → falso
```

Aplicada a `viewer` **e** `agent`, conforme decidido. `admin` e `owner` enxergam
todos os canais sem precisar de atribuição.

### Efeito nas conversas e mensagens

- **Conversas** — `viewer` e `agent` só enxergam conversas cujo canal lhes foi
  atribuído. Não é apenas o botão de responder que fica desabilitado: a conversa
  não aparece na lista.
- **Mensagens** — herdam o escopo da conversa.
- **Escrita do viewer** — `viewer` ganha inserção de mensagem e a atualização de
  conversa que o envio exige (último texto, contadores), restrita aos seus canais.
  Não ganha nenhuma outra escrita: continua sem poder apagar contato, criar negócio
  ou mexer em automação.

### Conversas órfãs

Conversas com `channel_id` nulo — resquício de canal removido, como já ocorre em
produção — ficam visíveis apenas para `admin` e `owner`. Não há canal para
atribuir, e escondê-las de todos perderia histórico real.

## 5. Dois riscos operacionais que a migração precisa cobrir

### Usuários existentes ficariam cegos

No instante em que a restrição entrar, os 6 usuários hoje em produção passam a não
enxergar conversa nenhuma — nenhum deles tem canal atribuído, porque a tabela não
existia.

**A migração precisa preencher `channel_members` com o produto dos usuários atuais
pelos canais atuais da conta antes de a regra passar a valer.** Sem isso, a escola
abre o sistema e encontra caixa de entrada vazia.

### Operador novo sem canal parece sistema quebrado

Um usuário convidado e ainda não atribuído a nenhum canal vê inbox vazio, sem
explicação. Precisa de estado vazio explícito — algo como *"você ainda não foi
atribuído a nenhum número; peça a um administrador"* — em vez de tela em branco
indistinguível de "não há conversas".

### Onde se atribui

Na tela de Membros da equipe (Configurações), por administrador. Cada membro passa
a ter a lista de canais que atende.

## 6. Menus e rotas por papel

| Menu | viewer | agent | admin / owner |
|---|---|---|---|
| Dashboard | ✓ | ✓ | ✓ |
| Caixa de entrada | ✓ | ✓ | ✓ |
| Notificações | ✓ | ✓ | ✓ |
| Contatos | ✓ | ✓ | ✓ |
| Pipelines | ✗ | ✓ | ✓ |
| Broadcasts | ✗ | ✓ | ✓ |
| Automações | ✗ | ✓ | ✓ |
| Fluxos | ✗ | ✓ | ✓ |
| Agentes IA | ✗ | ✓ | ✓ |
| Configurações | parcial — ver abaixo | parcial | ✓ |

O Dashboard é visível ao `viewer` — confirmado pelo cliente em 2026-07-31, depois
de eu tê-lo marcado como oculto por não constar da lista original ("caixa de
entrada, notificações, contatos").

### ⚠ Configurações não pode ser tudo-ou-nada

"Agent tem acesso a tudo exceto Configurações" não pode valer ao pé da letra: a
seção **Conta** contém *Seu perfil*, *Entrada e segurança* e *Aparência* — dados
pessoais que todo usuário precisa poder alterar, inclusive a própria senha.

Divisão adotada:

| Bloco de Configurações | Quem acessa |
|---|---|
| **Conta** — perfil, entrada e segurança, aparência | todos, inclusive `viewer` |
| **Espaço de trabalho** — WhatsApp, Modelos, Respostas rápidas, Campos e tags, Negócios e moeda, Membros, Chaves de API | `admin` e `owner` |

O menu "Configurações" continua visível para todos, mas mostra apenas o que o papel
alcança.

### Interação com o módulo de vendas

Papel e módulo são filtros **independentes e cumulativos**. A tabela acima descreve
o que cada papel alcança quando o módulo está ligado; se a conta desativar `sales`
(spec de adaptação escolar, seção 8), Pipelines desaparece para **todos**, inclusive
`owner`. Para o piloto, portanto, a linha "Pipelines" da tabela é inalcançável na
prática — ela vale para clientes que mantenham o módulo ativo.

### Menu escondido não é proteção

Ocultar item de menu é cosmético. A proteção real são as políticas do banco e o
bloqueio de rota — sem eles, basta digitar a URL. As três camadas são
implementadas: política, rota e menu.

## 7. Ordem de implementação

> **Este spec inteiro vem depois da adaptação escolar**
> (`2026-07-31-adaptacao-escolar-design.md`), por decisão do cliente em
> 2026-07-31: primeiro as configurações e ajustes de operação, a hierarquia por
> último.

| # | Etapa | Razão |
|---|---|---|
| 1 | `channel_members` + `can_access_channel` + migração de preenchimento | base de tudo; preenchimento evita cegar os usuários atuais |
| 2 | Escrita do `viewer` e escopo de canal nas políticas | o núcleo de segurança |
| 3 | UI de atribuição na tela de Membros | sem ela, admin não consegue operar o modelo |
| 4 | Estado vazio para operador sem canal | evita parecer defeito |
| 5 | Menus e rotas por papel | camada final, cosmética sobre proteção já existente |
| 6 | `admin` alcança o que faltava, menos transferência | ajuste pequeno e isolado |

## 8. Critérios de aceitação

- `viewer` atribuído ao canal A responde uma conversa do canal A com sucesso
- `viewer` atribuído ao canal A **não vê** nenhuma conversa do canal B na lista
- `agent` atribuído ao canal A também não vê conversas do canal B
- `admin` e `owner` veem conversas de todos os canais sem nenhuma atribuição
- `viewer` continua impedido de apagar contato, criar negócio ou editar automação
- Usuário sem nenhum canal atribuído vê mensagem explicativa, não tela vazia sem
  contexto
- Após a migração, os usuários que já existiam continuam vendo exatamente as
  conversas que viam antes
- `agent` acessa *Seu perfil* e troca a própria senha, mas não acessa *Membros da
  equipe*
- `admin` altera dados da conta e membros, mas recebe recusa ao tentar transferir a
  propriedade
- Requisição direta à rota de uma área sem permissão é recusada, não apenas
  escondida do menu
- Conversa com canal nulo aparece para `admin`, não para `viewer` nem `agent`

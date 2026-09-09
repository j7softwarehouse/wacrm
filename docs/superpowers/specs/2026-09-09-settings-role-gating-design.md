# Controle de acesso por seção em Configurações

**Data:** 2026-09-09
**Status:** aprovado, pronto para plano de implementação
**Origem:** surgiu durante a retestagem manual do checklist da Fase 3 de
grupos de WhatsApp (item 10 — testar com um usuário não-admin), mas o
escopo é mais amplo que grupos.

## 1. Objetivo

Impedir que os papéis `agent` e `viewer` vejam ou acessem (pela tela e pela
API) as áreas de Configurações que expõem dados sensíveis de WhatsApp —
mesmo sabendo a URL ou chamando a rota direto pelo DevTools.

## 2. Relação com a spec de controle de acesso de 2026-07-31

Já existe `2026-07-31-controle-acesso-design.md`, aprovada mas **nunca
implementada** (nenhuma migration, tabela ou plano correspondente foi
encontrado). Ela definia, na sua seção 6, uma regra mais ampla:

> **Espaço de trabalho** (WhatsApp, Modelos, Respostas rápidas, Campos e
> tags, Negócios e moeda, Membros, Chaves de API) → só `admin` e `owner`.

Esta spec **substitui essa regra específica**: `agent` passa a perder só
WhatsApp e Grupos, não o espaço de trabalho inteiro — decisão tomada
explicitamente em 2026-09-09, com conhecimento da regra anterior. As demais
partes da spec de julho (a tabela `channel_members` de atribuição de
operador a canal, e a restrição de quais conversas cada papel vê na Caixa
de Entrada) **não são tocadas aqui** — continuam como trabalho futuro em
aberto, se ainda fizer sentido.

## 3. Situação atual (verificada em código)

Não existe nenhum controle de acesso na própria página de Configurações
hoje. `src/app/(dashboard)/settings/page.tsx` monta a seção pedida por
`?tab=` sem checar papel nenhum; cada painel (`WhatsAppConfig`,
`GroupsManager`, etc.) só desabilita botões de escrita via
`useAuth().canEditSettings`. `SECTION_META` (`settings-sections.ts`) já
tem um precedente parecido — um comentário diz "`adminOnly` items are
hidden for non-admins" mas **esse campo não existe** na interface; é só
comentário aspiracional nunca implementado. O único filtro real hoje é por
módulo (`SECTION_MODULE`, esconde "Negócios" quando a conta desliga
vendas) em `settings-rail.tsx`, e o `SettingsPageInner` já tem o
equivalente de redirect (`if (section === 'deals' && !salesEnabled)
section = 'overview'`) — é este padrão exato que a seção 5 abaixo
generaliza para papel.

No backend, um levantamento de todas as rotas em `src/app/api/whatsapp/`
mostrou:

- Rotas de **escrita** (criar/remover canal, conectar, sair do grupo,
  renomear, participantes) já são bloqueadas para não-admin pela RLS do
  banco (`admins write channels`, `admins write groups`) — algumas com
  checagem explícita em código para dar uma mensagem clara em vez de
  deixar a RLS falhar silenciosamente (`PATCH /api/whatsapp/groups` é o
  exemplo já existente), outras dependendo só da RLS.
- Rotas de **leitura** usadas exclusivamente pelos painéis de
  Configurações → WhatsApp/Grupos **não têm nenhuma checagem de papel** —
  qualquer membro da conta autenticado (viewer incluso) pode chamá-las
  direto e ver os dados.

## 4. Modelo de acesso por seção

`minRole` novo em `SectionMeta` (`settings-sections.ts`), usando o mesmo
`AccountRole`/`hasMinRole` de `src/lib/auth/roles.ts`:

| Seção | `minRole` |
|---|---|
| `overview`, `profile`, `security`, `appearance` | `viewer` (todos) |
| `whatsapp`, `groups` | `admin` |
| `templates`, `quick-replies`, `fields`, `deals`, `members`, `api` | `agent` |

Efeito: `viewer` só enxerga o grupo "Conta" (perfil, segurança, aparência)
e a Visão geral; `agent` enxerga tudo isso mais o resto do espaço de
trabalho, exceto WhatsApp e Grupos; `admin`/`owner` continuam vendo tudo.

## 5. Aplicação na tela

**`SettingsRail`**: o filtro que já existe por seção (`items =
SETTINGS_SECTIONS.filter(...)`) ganha mais uma condição, junto da checagem
de módulo já existente: `hasMinRole(effectiveRole, SECTION_META[s].minRole)`.

**`SettingsPageInner`**: generaliza o redirect que já existe para
`deals`/`salesEnabled`. Ordem importa por causa do carregamento
assíncrono do papel:

```
let section = resolveSection(searchParams.get('tab'));
if (section === 'deals' && !salesEnabled) section = 'overview';
if (!profileLoading && !hasMinRole(accountRole ?? 'viewer', SECTION_META[section].minRole)) {
  section = 'overview';
}
```

**Por que esperar `!profileLoading` antes de redirecionar:** `accountRole`
começa `null` até o perfil carregar. Sem esperar, um `admin` que entra
direto em `/settings?tab=whatsapp` (o link do menu da conta aponta pra lá,
por comentário já existente no arquivo) seria jogado pra Visão geral por
uma fração de segundo antes do papel resolver — e como o redirect usa
`router.replace`, a URL já teria mudado e o usuário não voltaria sozinho
pra aba certa. Enquanto `profileLoading` é `true`, a seção pedida renderiza
normalmente; se o papel realmente não alcançar depois que carrega, o
redirect dispara então. Essa janela é sub-segundo e não expõe dado real,
porque as rotas de API por trás (seção 6) já recusam a leitura
independentemente do que a tela mostra.

`accountRole ?? 'viewer'` trata um papel ainda não resolvido (só possível
depois de `profileLoading` virar falso, um caso de erro/perfil ausente)
como o menos privilegiado — falha fechado.

## 6. Aplicação no backend (defesa em profundidade)

Adiciona a mesma checagem explícita `canEditSettings(role)` (admin+) que
`PATCH /api/whatsapp/groups` já usa, com mensagem de erro clara (403), às
rotas cujo único consumidor é o painel WhatsApp ou Grupos de
Configurações:

- `GET /api/whatsapp/config`
- `GET /api/whatsapp/config/verify-registration`
- `GET /api/whatsapp/channels/[id]/webhook-url`
- `GET /api/whatsapp/channels/[id]/status`
- `GET /api/whatsapp/groups`
- `GET /api/whatsapp/groups/[id]/participants`
- `POST /api/whatsapp/groups/sync`

**Deliberadamente sem mudança** (compartilhadas com partes do app fora de
Configurações, usadas por todo papel):

- `GET /api/whatsapp/channels` (lista básica) — a Caixa de Entrada usa esta
  mesma rota para nome/rótulo do canal de cada conversa
  (`src/app/(dashboard)/inbox/page.tsx`); travar isso quebraria o Inbox
  para `agent`.
- `POST /api/whatsapp/groups/[id]/open` (botão "Conversar") — ação de
  mandar mensagem, não de administrar o grupo; continua aberta a qualquer
  membro da conta, por decisão já tomada quando essa rota foi criada.
- Rotas de escrita já protegidas pela RLS (POST/DELETE canais, POST
  connect, PATCH/POST participantes/nome/sair do grupo) — nenhuma mudança
  de comportamento necessária; um acréscimo de checagem explícita para
  mensagem de erro mais clara (como já existe em `PATCH
  /api/whatsapp/groups`) é opcional e fica a critério de quem implementar
  cada rota, não é requisito desta spec.

## 7. Critérios de aceitação

- `viewer` logado não vê WhatsApp, Grupos, Modelos, Respostas rápidas,
  Campos e tags, Negócios, Membros nem Chaves de API na barra lateral de
  Configurações — só Visão geral, Seu perfil, Entrada e segurança,
  Aparência.
- `agent` logado não vê WhatsApp nem Grupos na barra lateral, mas vê e usa
  normalmente Modelos, Respostas rápidas, Campos e tags, Negócios,
  Membros e Chaves de API.
- `agent`/`viewer` que colam `/settings?tab=whatsapp` ou
  `?tab=groups` direto na URL são redirecionados para a Visão geral, não
  veem o painel por uma fração de segundo sequer com dado real (a API por
  trás já recusa).
- `admin`/`owner` que entram direto em `/settings?tab=whatsapp` (via link
  do menu da conta) veem a aba normalmente, sem nenhum flash de redirect.
- Uma chamada direta (`curl`/DevTools) de `agent` ou `viewer` para
  qualquer uma das 7 rotas listadas na seção 6 devolve 403 com mensagem
  clara, não os dados.
- `GET /api/whatsapp/channels` e `POST /api/whatsapp/groups/[id]/open`
  continuam respondendo normalmente para `agent`/`viewer` — nenhuma
  regressão no Inbox nem no botão "Conversar".
- Suíte de testes cobre, por rota nova, pelo menos um caso 403
  (agent/viewer) e um caso 200 (admin/owner).

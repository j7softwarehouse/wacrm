# Separação em três ambientes (dev, homologação, produção)

**Data:** 2026-07-29
**Status:** aprovado, pronto para plano de implementação

## 1. Objetivo

Hoje dev local, preview da Vercel e produção apontam para **o mesmo** projeto
Supabase. Isso já causou dano observável: conversas de teste no mesmo banco que
serve produção, e uma colisão de índice único que derrubou a remoção de canal
com erro 500.

O objetivo é isolar três ambientes de forma que uma evolução do sistema possa
ser validada sem tocar em produção, e que dados de teste nunca cheguem lá.

Um segundo problema, descoberto durante o desenho, tem o mesmo peso: a
instância UAZAPI aceita **um único webhook por vez** (`registerUazapiWebhook`
sobrescreve a configuração — ver `src/lib/whatsapp/uazapi/register-webhook.ts`).
Conectar a instância de produção em homologação faria produção parar de receber
mensagens **silenciosamente**. Separar bancos não protege contra isso; separar
instâncias sim.

## 2. Escopo

### Incluído

- Três ambientes com bancos Supabase isolados.
- Três branches com papéis distintos e deploy correspondente na Vercel.
- Quatro instâncias UAZAPI (2 produção, 1 homologação, 1 dev).
- Supabase CLI como mecanismo de aplicação de migrations, substituindo o
  copiar/colar manual no SQL Editor.
- Limpeza total do banco de produção, incluindo contas de usuário.
- Procedimento manual de backup (`supabase db dump`), já que o plano free não
  oferece backup restaurável.

### Excluído

- Alteração de `main` ou dos PRs de terceiros do projeto open-source upstream.
- Seed data automático — os ambientes começam vazios por decisão explícita.
- Troca da `ENCRYPTION_KEY` de produção: ela decifra tokens UAZAPI já gravados
  e não há motivo para movê-la.
- CI/CD automatizando `db push` — as migrations são aplicadas por comando
  explícito, um ambiente por vez.

## 3. Mapa dos ambientes

| | **Dev** | **Homologação** | **Produção** |
|---|---|---|---|
| Banco | Supabase local (Docker) | Projeto novo na nuvem | Projeto atual (`jynplnaslifzftyhasna`), zerado |
| Branch | qualquer, local | `staging` | `production` |
| URL | `localhost:3000` | URL de branch da Vercel (estável) | URL de produção da Vercel |
| UAZAPI | 1 instância + túnel Cloudflare | 1 instância | 2 instâncias (números do cliente) |
| Plano Supabase | local, gratuito | free | free (risco assumido — ver §8) |

`main` permanece como espelho do projeto open-source upstream
(`ArnasDon/wacrm`) e **nunca é a origem do deploy de produção** — a Vercel pode
gerar um preview a partir dele como faz com qualquer branch, o que é inofensivo.
Manter `main` alinhado ao upstream preserva a capacidade de puxar melhorias do
projeto original: hoje ele está 34 commits atrás do upstream, enquanto a
customização do Instituto Emanuel soma 38 commits próprios.

### Fluxo de promoção

```
feature/X  →  push  →  preview automático        (banco de homologação, sem WhatsApp)
              ↓ validou
           merge em `staging`  →  homologação      (banco + instância de homologação)
              ↓ validou
           merge em `production`  →  produção      (banco + 2 instâncias do cliente)
```

`staging` existe como branch fixa porque a URL de preview da Vercel muda a cada
deploy, e o registro de webhook exige endereço estável. Uma branch fixa recebe
uma URL de branch estável; sem isso o webhook de homologação teria de ser
re-registrado a cada push.

## 4. Variáveis de ambiente

Cada ambiente recebe seu próprio conjunto. Pontos que não são óbvios:

- **`NEXT_PUBLIC_SITE_URL` fica vazio em Preview.** Um valor fixo apontaria
  para um deploy específico. Vazio, `getBaseUrl` resolve pelo cabeçalho
  `x-forwarded-host` que a Vercel preenche (ver `src/lib/http/base-url.ts`).
  Em `staging` e `production` o valor é explícito.
- **`ENCRYPTION_KEY`**: produção mantém a atual; dev e homologação recebem
  chaves novas e distintas.
- **`SUPABASE_SERVICE_ROLE_KEY`** de cada banco nunca cruza ambientes.

## 5. Migrations sob a Supabase CLI

A CLI exige nomes no formato `20260729110603_nome.sql` (timestamp de 14
dígitos, verificado rodando `supabase migration new`). As 43 migrations atuais
usam `001_`, `002_`. Além disso, todas foram aplicadas manualmente pelo SQL
Editor, então a tabela de histórico `supabase_migrations.schema_migrations`
está vazia nos bancos remotos — um `db push` tentaria reaplicar tudo do zero.

Sequência:

1. **Renomear as 43 migrations** para timestamps sintéticos que preservem a
   ordem atual (`001_initial_schema.sql` → `20250101000001_initial_schema.sql`,
   e assim por diante). Commit único e mecânico.
2. **`supabase db reset` no banco local**, que recria do zero e roda as 43 em
   sequência. Este é o teste de validade: se alguma migration não roda limpa a
   partir de um banco vazio, o problema aparece aqui, sem risco.
3. **`supabase migration repair --status applied`** nos bancos remotos,
   marcando as 43 como já aplicadas.

Daí em diante, cada mudança de schema é uma migration nova aplicada com
`db push`, um ambiente por vez, seguindo a ordem de promoção.

**Regra permanente:** `supabase db reset` é destrutivo e só pode ser executado
contra o banco **local**. Nunca contra homologação ou produção.

## 6. Limpeza do banco de produção

O banco atual contém apenas dados de teste e será zerado por completo,
incluindo contas de usuário.

A ordem é obrigatória por uma razão de integridade referencial:
`accounts.owner_user_id` usa `ON DELETE RESTRICT`
(`supabase/migrations/017_account_sharing.sql:66`), portanto apagar `auth.users`
diretamente **falha** enquanto existirem contas apontando para esses usuários.

1. Apagar os dados de `public` — as `accounts` levam a maior parte em cascata,
   já que as tabelas referenciam `auth.users(id)` com `ON DELETE CASCADE`.
2. Só então apagar as linhas de `auth.users`.
3. Confirmar que o schema permanece intacto (as 43 migrations não são
   revertidas — apenas os dados saem).

### Validação prévia obrigatória

O trigger `on_auth_user_created` → `handle_new_user()`
(`supabase/migrations/001_initial_schema.sql:400`) é o que cria conta e perfil
no primeiro cadastro. Se ele estiver quebrado, ninguém consegue entrar depois
da limpeza — inclusive o administrador.

Por isso, **o fluxo de cadastro é validado em homologação antes** de a limpeza
de produção acontecer. Descobrir isso num banco descartável custa nada;
descobrir em produção significa ficar trancado fora do sistema.

## 7. Propriedade da conta de produção

O papel `owner` não pode ser atribuído por convite: `017_account_sharing.sql:94`
impõe `CHECK (role <> 'owner')`. Os papéis disponíveis são `owner`, `admin`,
`agent` e `viewer`. Um proprietário só surge de duas formas — pelo primeiro
cadastro, ou por transferência via `/api/account/transfer-ownership`.

Decisão: o administrador do projeto faz o primeiro cadastro e assume como
proprietário, configura os dois canais UAZAPI e valida a operação. A escola é
convidada como `admin`. A transferência de propriedade fica como decisão do
momento da entrega, e a rota de transferência já existe para viabilizá-la.

## 8. Riscos assumidos

**Plano free em produção.** Confirmado na documentação oficial do Supabase:
projetos do plano free são pausados após um período de sete dias com baixa
atividade, e backups não ficam disponíveis para download. Para uma escola isso
tem consequência concreta — férias de julho e janeiro podem pausar o banco, e
não há restauração automática em caso de acidente.

Esse risco foi apresentado e assumido conscientemente. A mitigação, sem custo,
é um `supabase db dump` manual guardado fora da plataforma, executado antes de
qualquer migration em produção e periodicamente durante a operação. O plano Pro
(US$25/mês) resolve as duas questões e permanece registrado como caminho
recomendado quando a escola entrar em operação real.

## 9. Ordem de execução

Produção é a última coisa tocada, e tudo que acontece nela já terá sido
ensaiado antes.

1. Docker ativo, Supabase local no ar, migrations renomeadas, `db reset`
   validando as 43 do zero. *Risco zero: nada remoto é tocado.*
2. Criar o projeto de homologação, aplicar migrations, validar o fluxo de
   cadastro. *Risco zero: banco novo e descartável.*
3. Configurar a Vercel — variáveis por ambiente, branches `staging` e
   `production`. *Risco zero: produção segue servindo o que já serve.*
4. Fazer o dump de segurança, limpar produção e rodar `migration repair`.
   *Ponto de risco, e o único.*
5. Levar a customização para `production` e disparar o deploy.
6. Reconectar as duas instâncias UAZAPI de produção e confirmar o recebimento
   de mensagens.

## 10. Critérios de aceitação

- Uma mensagem enviada à instância de homologação aparece no banco de
  homologação e **não** aparece em produção.
- Uma mensagem enviada às instâncias de produção continua chegando em produção
  depois de qualquer deploy em `staging`.
- `supabase db reset` no ambiente local recria as 43 migrations sem erro.
- `supabase db push` aplica uma migration nova em um ambiente sem afetar os
  demais.
- Um deploy em `production` preserva integralmente os dados existentes.
- O primeiro cadastro em produção cria conta e perfil, e o acesso funciona.

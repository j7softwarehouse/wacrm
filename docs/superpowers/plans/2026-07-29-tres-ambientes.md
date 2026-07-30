# Separação em Três Ambientes — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Isolar dev, homologação e produção em bancos Supabase e instâncias UAZAPI próprios, com migrations aplicadas pela Supabase CLI, de modo que nenhuma evolução do sistema toque em dados de produção.

**Architecture:** Três ambientes, cada um com sua instância UAZAPI. Dev e homologação compartilham um mesmo projeto Supabase na nuvem (o free do Supabase permite 2 projetos ativos por organização, e a conta já tinha 1 ativo — produção — mais 1 pausado de outro produto que não conta para o limite); produção tem seu próprio projeto. As branches `staging` e `production` mapeiam para os ambientes remotos na Vercel, enquanto `main` permanece espelhando o projeto open-source upstream. A produção é a última coisa tocada, e tudo que acontece nela já terá sido ensaiado em dev e homologação.

**Tech Stack:** Supabase CLI 2.110.0, Vercel CLI 58.1.0, Next.js 16.2.12, PostgreSQL, UAZAPI.

**Spec:** `docs/superpowers/specs/2026-07-29-tres-ambientes-design.md`

## Global Constraints

- Nenhum comando destrutivo (`db reset` ou equivalente) roda contra homologação ou produção — homologação agora também serve dev, e ambos os ambientes carregam dado que alguém depende de preservar (a validação prévia do fluxo de cadastro, e potencialmente mais conforme o dia a dia de dev acumula).
- Nenhuma tarefa altera `main` nem os PRs de terceiros do projeto upstream (`ArnasDon/wacrm`).
- A `ENCRYPTION_KEY` de produção **não muda** — ela decifra tokens UAZAPI já gravados. Homologação e dev **compartilham a mesma** `ENCRYPTION_KEY`, gerada uma única vez na Task 2, porque compartilham o mesmo banco: chaves diferentes impediriam um lado decifrar tokens gravados pelo outro.
- `NEXT_PUBLIC_SITE_URL` fica **vazio** no ambiente Preview da Vercel; `getBaseUrl` resolve pelo cabeçalho `x-forwarded-host`.
- A `SUPABASE_SERVICE_ROLE_KEY` de um ambiente nunca é usada em outro.
- Produção só é tocada a partir da Task 5. As Tasks 0–4 não têm risco sobre ela.
- **Produção está em operação real desde 2026-07-29**, com conversas de pais do Instituto Emanuel. Nenhuma tarefa apaga dado de produção — as Tasks 5, 6 e 7 foram reescritas em 2026-07-30 para serem aditivas ou de verificação. Se alguma instrução mandar truncar tabela, apagar usuário ou remover canal em produção, **é texto obsoleto: parar e reportar**.
- O canal `553189891123` ("Instituto Emanuel") não pode ser removido nem recadastrado: removê-lo orfana as conversas reais em andamento.
- Toda operação em produção exige os dumps da Task 5 concluídos antes.
- Nenhuma tarefa roda `npm run dev` antes da Task 2: até lá o `.env.local` aponta para o banco de produção, e o dev local escreveria na base viva do cliente.
- Nenhum dado de seed é criado além da conta de teste da Task 2, necessária para validar o cadastro.

## Ações que exigem o usuário

Estas etapas não podem ser executadas por um agente e estão sinalizadas dentro das tarefas:

| Ação | Task |
|---|---|
| Criar o projeto Supabase de homologação-e-dev e fornecer a senha do banco | 2 |
| Criar uma conta de teste em `/signup` local | 2 |
| Fornecer a senha do banco de produção | 5 |
| Criar 1 instância UAZAPI de homologação | 4 |
| Criar/confirmar 2 instâncias UAZAPI de produção | 7 |

O primeiro cadastro em produção (que criou a conta `owner`) já aconteceu antes
deste plano ser retomado — a Task 6 apenas confirma que ele segue intacto após
o deploy migrar para a branch `production`.

**Sobre `$VERCEL_TOKEN`:** os comandos das Tasks 3 e 6 usam essa variável. Ela é o token da Vercel, e deve ser exportada na sessão do shell antes de rodá-los (`export VERCEL_TOKEN=<token>`), nunca escrita em arquivo versionado. O mesmo vale para as chaves `service_role` — elas aparecem apenas como argumento de comando, jamais commitadas.

---

### Task 0: Descartar os resíduos da tentativa de deploy no Cloudflare

O working tree carrega arquivos de uma tentativa abandonada de deploy via
Cloudflare Workers. Nada disso está commitado, e a Task 3 cria branches a partir
do HEAD — mas enquanto o resíduo estiver solto, um `git add -A` distraído em
qualquer tarefa posterior o levaria para dentro de `production`.

O estado commitado já foi verificado e é consistente: `package.json` e
`package-lock.json` no HEAD concordam em `next@16.2.12`, então `npm ci` funciona
a partir de um checkout limpo.

**Files:**
- Delete: `wrangler.jsonc`, `open-next.config.ts`, `public/_headers`
- Restore: `.gitignore`, `package.json`, `package-lock.json`

**Interfaces:**
- Produces: working tree limpo. Todas as tarefas seguintes assumem isso.

- [ ] **Step 1: Conferir o que está solto**

```bash
git status --short
```

Esperado: `.gitignore`, `package.json` e `package-lock.json` modificados, mais
`open-next.config.ts`, `public/_headers` e `wrangler.jsonc` não rastreados.

Se aparecer qualquer outro arquivo, **parar e investigar** antes de descartar —
pode ser trabalho legítimo ainda não commitado.

- [ ] **Step 2: Remover os arquivos não rastreados**

```bash
rm -f wrangler.jsonc open-next.config.ts public/_headers
```

- [ ] **Step 3: Restaurar os arquivos modificados ao estado commitado**

```bash
git checkout -- .gitignore package.json package-lock.json
```

Isso remove do `package.json` as dependências `@opennextjs/cloudflare` e
`wrangler` e os scripts `preview`/`deploy`/`upload`/`cf-typegen`, que só serviam
ao Cloudflare.

- [ ] **Step 4: Confirmar que o working tree está limpo**

```bash
git status --short
```

Esperado: nenhuma saída.

- [ ] **Step 5: Confirmar que o projeto ainda constrói a partir do estado limpo**

```bash
npm ci
npm run build
```

Esperado: build concluído sem erro. Isso prova que o HEAD é deployável por si só
— o que importa porque, a partir da Task 3, a Vercel passa a construir a partir
do Git, e não mais do upload do diretório local.

Não há commit nesta tarefa: ela apenas descarta o que nunca foi versionado.

---

### Task 1: Inicializar a Supabase CLI e renomear as 43 migrations

A CLI exige nomes no formato `<timestamp de 14 dígitos>_nome.sql`. As atuais usam `001_`, `002_`, e a CLI as ignora por completo.

**Files:**
- Create: `supabase/config.toml`
- Rename: os 43 arquivos de `supabase/migrations/`

**Interfaces:**
- Produces: migrations nomeadas `20250101000001_initial_schema.sql` … `20250101000043_notifications_pt_br.sql`, na mesma ordem lógica de hoje. As Tasks 2 e 5 dependem desses nomes.

- [ ] **Step 1: Verificar o estado inicial**

```bash
ls supabase/migrations | wc -l          # esperado: 43
ls supabase/migrations | head -2        # esperado: 001_initial_schema.sql, 002_...
```

- [ ] **Step 2: Inicializar a CLI**

```bash
npx supabase init
```

Se perguntar sobre gerar arquivos de configuração para editores (VS Code / IntelliJ), responder **não** — não faz parte deste trabalho.

Isso cria `supabase/config.toml`. O diretório `supabase/migrations` já existe e é preservado.

- [ ] **Step 3: Renomear as migrations preservando o histórico do git**

`git mv` mantém o rastreamento de renomeação; `mv` puro faria o git enxergar 43 arquivos apagados e 43 criados.

```bash
cd supabase/migrations
for f in [0-9][0-9][0-9]_*.sql; do
  num="${f%%_*}"
  rest="${f#*_}"
  ts=$(printf "202501010000%02d" "$((10#$num))")
  git mv "$f" "${ts}_${rest}"
done
cd ../..
```

O prefixo `202501010000` tem 12 dígitos e o sufixo 2, totalizando os 14 exigidos. A ordem alfabética resultante é idêntica à ordem numérica atual.

- [ ] **Step 4: Verificar o resultado**

```bash
ls supabase/migrations | wc -l     # esperado: 43
ls supabase/migrations | head -2   # esperado: 20250101000001_initial_schema.sql
ls supabase/migrations | tail -1   # esperado: 20250101000043_notifications_pt_br.sql
ls supabase/migrations | grep -c "^[0-9]\{14\}_"   # esperado: 43
```

Todos os 43 devem casar com o padrão de 14 dígitos. Se algum sobrar com nome antigo, o loop falhou e precisa ser investigado antes de seguir.

- [ ] **Step 5: Confirmar que o git enxergou renomeações, não exclusões**

```bash
git status --short | grep -c "^R"   # esperado: 43
```

Se aparecerem linhas `D` (deleted) e `??` (untracked) no lugar de `R` (renamed), o histórico foi perdido — desfazer com `git checkout -- supabase/migrations` e refazer com `git mv`.

- [ ] **Step 6: Commit**

```bash
git add supabase/
git commit -m "chore(db): renomeia migrations para o formato da Supabase CLI

A CLI exige <timestamp de 14 digitos>_nome.sql e ignorava os nomes
001_, 002_. Timestamps sinteticos preservam a ordem original."
```

---

### Task 2: Projeto Supabase de homologação-e-dev, migrations aplicadas e dev local configurado

> ⚠️ **REESCRITA EM 2026-07-30.** A versão original usava Supabase local via
> Docker para dev, separado do banco de homologação. Como a conta só tem espaço
> para 1 projeto Supabase novo no plano free (§0 do spec, revisão de
> 2026-07-30), dev e homologação passam a compartilhar o mesmo projeto na
> nuvem. Isso elimina o Docker por completo — nada de `supabase start`,
> `supabase db reset` nem containers para manter.

Este é o teste mais valioso do plano: se alguma das 43 migrations não roda a
partir de um banco vazio, o problema aparece aqui, contra um banco novo e
descartável, e não em produção. Como o projeto acabou de ser criado, aplicar as
migrations nele **já é** esse teste — não precisa de um passo de validação
separado.

**Files:**
- Modify: `.env.local`

**Interfaces:**
- Consumes: as migrations renomeadas na Task 1.
- Produces: projeto de homologação-e-dev com as 43 migrations aplicadas; URL, `anon key`, `service_role key` e uma `ENCRYPTION_KEY` compartilhada, consumidos pela Task 3 para configurar o ambiente Preview da Vercel. Dev local configurado e validado.

> **AÇÃO DO USUÁRIO:** criar um projeto novo no painel do Supabase (nome sugerido: `wacrm-homologacao`, já que serve tanto dev quanto homologação), guardar a senha do banco definida na criação e anotar o *project ref* (a sequência de caracteres na URL do projeto).

- [ ] **Step 1: Linkar a CLI ao projeto**

```bash
npx supabase link --project-ref <ref-do-projeto>
```

A CLI pedirá a senha do banco definida na criação do projeto.

- [ ] **Step 2: Conferir o que seria aplicado, sem aplicar**

```bash
npx supabase db push --dry-run
```

Esperado: a lista das 43 migrations como pendentes. O banco é novo e está vazio, portanto **não** se usa `migration repair` aqui — `repair` é exclusivo da Task 5, em produção, onde o schema já existe.

- [ ] **Step 3: Aplicar as migrations — é aqui que qualquer defeito aparece**

```bash
npx supabase db push
```

Esperado: as 43 aplicam sem erro, em sequência. **Qualquer erro aqui é um defeito real numa migration** e deve ser corrigido antes de prosseguir — o mesmo erro apareceria em produção se não fosse pego agora.

- [ ] **Step 4: Confirmar o histórico remoto**

```bash
npx supabase migration list --linked
```

Esperado: as 43 aparecem com versão local e remota correspondentes.

- [ ] **Step 5: Confirmar que o banco nasceu vazio de dados**

No SQL Editor do projeto:

```sql
SELECT
  (SELECT count(*) FROM auth.users)         AS usuarios,
  (SELECT count(*) FROM accounts)           AS contas,
  (SELECT count(*) FROM whatsapp_channels)  AS canais,
  (SELECT count(*) FROM conversations)      AS conversas;
```

Esperado: `0, 0, 0, 0` — schema presente, dados ausentes.

- [ ] **Step 6: Registrar as credenciais**

No painel do projeto, em *Project Settings → API*, copiar a *Project URL*, a chave `anon` e a chave `service_role`. A Task 3 consome os três valores. Não commitar nada disso.

- [ ] **Step 7: Gerar a ENCRYPTION_KEY compartilhada**

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Esta é **a mesma chave** que a Task 3 configura no ambiente Preview da Vercel — dev e homologação compartilham o banco, então precisam compartilhar a chave que decifra o que está gravado nele. Guardar a saída; ela é usada no Step 8 e novamente na Task 3.

- [ ] **Step 8: Apontar o dev local para o projeto**

Escrever `.env.local` com os valores dos Steps 6 e 7:

```
NEXT_PUBLIC_SUPABASE_URL=<Project URL do Step 6>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key do Step 6>
SUPABASE_SERVICE_ROLE_KEY=<service_role key do Step 6>
ENCRYPTION_KEY=<chave gerada no Step 7>
META_APP_SECRET=nao-usado-em-dev
NEXT_PUBLIC_SITE_URL=http://localhost:3000
NEXT_PUBLIC_APP_LOCALE=pt
```

- [ ] **Step 9: Confirmar que `.env.local` não vai para o git**

```bash
git check-ignore .env.local && echo "IGNORADO (correto)" || echo "PERIGO: seria commitado"
```

Já confirmado como ignorado anteriormente nesta sessão; este passo é só a reconfirmação depois de reescrever o arquivo.

- [ ] **Step 10: Subir a aplicação e validar o cadastro**

```bash
npm run dev
```

No navegador, acessar `http://localhost:3000/signup` e criar uma conta de teste.

Esperado: o cadastro conclui e a aplicação abre autenticada. Isso exercita o trigger `on_auth_user_created` → `handle_new_user()` (`supabase/migrations/001_initial_schema.sql:400`), que cria conta e perfil. Uma falha aqui é um defeito real a investigar antes de seguir — o mesmo trigger roda em qualquer ambiente.

- [ ] **Step 11: Confirmar no banco que conta e perfil nasceram**

No SQL Editor do projeto (o mesmo do Step 5, agora na nuvem — não há Studio local):

```sql
SELECT
  (SELECT count(*) FROM auth.users)  AS usuarios,
  (SELECT count(*) FROM accounts)    AS contas,
  (SELECT count(*) FROM profiles)    AS perfis;
```

Esperado: `1, 1, 1`. Qualquer zero indica que o trigger não disparou.

Nenhum commit nesta tarefa: `.env.local` é local e gitignored por construção.

---

### Task 3: Branches `staging`/`production` e variáveis isoladas na Vercel

Hoje `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` estão configuradas para *Production, Preview e Development* com **o mesmo valor** — é literalmente o defeito que motivou este plano: qualquer preview escreve no banco de produção.

**Files:** nenhum arquivo do repositório é alterado.

**Interfaces:**
- Consumes: as credenciais e a `ENCRYPTION_KEY` compartilhada da Task 2.
- Produces: branch `production` como origem do deploy de produção e `staging` como ambiente de homologação com URL estável. A Task 4 depende da URL de `staging`; a Task 6 depende de `production`.

- [ ] **Step 1: Criar as duas branches a partir do trabalho atual**

```bash
git branch production HEAD
git branch staging HEAD
git push -u origin production staging
```

`main` não é tocada, conforme as Global Constraints.

- [ ] **Step 2: Apontar a produção da Vercel para a branch `production`**

> **AÇÃO DO USUÁRIO:** no painel da Vercel, em *Settings → Git → Production Branch*, trocar `main` por `production` e salvar.

Conferir que pegou:

```bash
curl -s "https://api.vercel.com/v9/projects/wacrm?teamId=team_axCKQZ36lFoeBLGuj19cxv7G" \
  -H "Authorization: Bearer $VERCEL_TOKEN" \
  | python3 -c "import json,sys; print(json.load(sys.stdin).get('link',{}).get('productionBranch'))"
```

Esperado: `production`. Enquanto isso não mudar, um push em `main` (que espelha o upstream open-source) dispararia um deploy de produção — exatamente o que este plano evita.

- [ ] **Step 3: Remover as variáveis de Preview que apontam para produção**

```bash
npx vercel --token $VERCEL_TOKEN env rm NEXT_PUBLIC_SUPABASE_URL preview --yes
npx vercel --token $VERCEL_TOKEN env rm NEXT_PUBLIC_SUPABASE_ANON_KEY preview --yes
npx vercel --token $VERCEL_TOKEN env rm SUPABASE_SERVICE_ROLE_KEY preview --yes
npx vercel --token $VERCEL_TOKEN env rm ENCRYPTION_KEY preview --yes
```

- [ ] **Step 4: Recriar as variáveis de Preview apontando para homologação**

```bash
npx vercel --token $VERCEL_TOKEN env add NEXT_PUBLIC_SUPABASE_URL preview \
  --value "<URL do projeto de homologacao>" --no-sensitive --yes
npx vercel --token $VERCEL_TOKEN env add NEXT_PUBLIC_SUPABASE_ANON_KEY preview \
  --value "<anon key de homologacao>" --no-sensitive --yes
npx vercel --token $VERCEL_TOKEN env add SUPABASE_SERVICE_ROLE_KEY preview \
  --value "<service_role key de homologacao>" --yes
```

Registrar a **mesma** `ENCRYPTION_KEY` gerada na Task 2 (Step 7) — não gerar uma
nova. Dev e homologação compartilham o banco, e uma chave diferente aqui
impediria a aplicação, rodando em Preview, de decifrar tokens gravados
enquanto rodava localmente (ou vice-versa):

```bash
npx vercel --token $VERCEL_TOKEN env add ENCRYPTION_KEY preview --value "<chave da Task 2, Step 7>" --yes
```

- [ ] **Step 5: Garantir que `NEXT_PUBLIC_SITE_URL` não exista em Preview**

```bash
npx vercel --token $VERCEL_TOKEN env ls | grep NEXT_PUBLIC_SITE_URL
```

Esperado: aparecer apenas para `Production`. Se constar `Preview`, remover:

```bash
npx vercel --token $VERCEL_TOKEN env rm NEXT_PUBLIC_SITE_URL preview --yes
```

Vazio em Preview é intencional: `getBaseUrl` (`src/lib/http/base-url.ts`) resolve pelo `x-forwarded-host` que a Vercel preenche, o que faz cada preview apontar para si mesmo.

- [ ] **Step 6: Publicar `staging` e capturar sua URL estável**

```bash
git checkout staging
npx vercel --token $VERCEL_TOKEN deploy --yes
```

Anotar a URL de branch (formato `wacrm-git-staging-<team>.vercel.app`), que é estável entre deploys. A Task 4 registra o webhook contra ela.

- [ ] **Step 7: Provar que homologação escreve no banco certo**

O projeto já tem ao menos 1 usuário — a conta de teste criada localmente na
Task 2 — porque dev e homologação compartilham o mesmo banco. A prova aqui não
é "existe 1 usuário", é "criar um pela URL de `staging` incrementa a mesma
contagem, e produção não se move":

```sql
SELECT count(*) FROM auth.users;
```

Anotar o valor atual. Acessar a URL de `staging`, criar uma conta de teste nova
e rodar a mesma consulta de novo.

Esperado: a contagem aumentou em exatamente 1. Em seguida, rodar a mesma
consulta no **banco de produção**: o número de usuários lá **não pode** ter
mudado. Esta é a primeira prova concreta do isolamento entre homologação e
produção — o isolamento entre dev e homologação foi conscientemente abandonado
nesta revisão.

---

### Task 4: Instância UAZAPI de homologação e prova de isolamento do WhatsApp

Esta é a tarefa que valida o risco central do spec: a instância UAZAPI aceita **um único webhook por vez**, e `registerUazapiWebhook` sobrescreve a configuração (`src/lib/whatsapp/uazapi/register-webhook.ts:17-19`).

**Files:** nenhum arquivo do repositório é alterado.

**Interfaces:**
- Consumes: a URL estável de `staging` da Task 3.
- Produces: prova de que homologação e produção recebem mensagens de forma independente. Nenhuma task posterior depende tecnicamente desta, mas ela é o gate que autoriza mexer em produção.

> **AÇÃO DO USUÁRIO:** criar no painel da UAZAPI **uma instância nova**, dedicada à homologação, com um número de teste. Não reutilizar nenhuma das instâncias de produção.

- [ ] **Step 1: Cadastrar o canal de homologação**

Na URL de `staging`, acessar *Configurações → WhatsApp → Adicionar canal*, informando a URL base e o token da instância de homologação. Conectar por QR Code.

- [ ] **Step 2: Confirmar que o webhook apontou para `staging`**

No SQL Editor do banco de **homologação**:

```sql
SELECT label, status, webhook_registered_at, last_error
FROM whatsapp_channels;
```

Esperado: uma linha, `status = 'connected'`, `webhook_registered_at` preenchido e `last_error` nulo. Um `last_error` preenchido indica que `getBaseUrl` não derivou uma URL confiável.

- [ ] **Step 3: Enviar uma mensagem real para o número de homologação**

Do celular, mandar uma mensagem para o número da instância de homologação.

- [ ] **Step 4: Confirmar a chegada em homologação**

No banco de **homologação**:

```sql
SELECT c.id, m.content_text, m.created_at
FROM messages m
JOIN conversations c ON c.id = m.conversation_id
ORDER BY m.created_at DESC
LIMIT 5;
```

Esperado: a mensagem enviada aparece.

- [ ] **Step 5: Confirmar que produção não foi afetada — o critério que importa**

No SQL Editor do banco de **produção**:

```sql
SELECT count(*) AS mensagens, max(created_at) AS ultima
FROM messages;
```

Esperado: nenhuma mensagem nova em relação ao estado anterior ao Step 3. E, no painel da UAZAPI, a instância de produção deve continuar com seu webhook original intacto.

Se a instância de produção tiver perdido o webhook, alguma credencial foi reaproveitada — **parar e corrigir antes da Task 5**, porque significa que o isolamento não existe.

---

### Task 5: Dump de segurança e `migration repair` em produção

> ⚠️ **ESTA TAREFA FOI REESCRITA EM 2026-07-30. NÃO EXECUTE A VERSÃO ANTERIOR.**
>
> A versão original apagava o banco de produção por completo (`TRUNCATE` em
> todas as tabelas de `public` + `DELETE FROM auth.users`), porque quando o
> plano foi escrito produção continha **apenas dados de teste**.
>
> **Isso deixou de ser verdade.** Em 2026-07-29 o canal "Instituto Emanuel"
> (`553189891123`) entrou em operação real: existem conversas de pais sobre
> matrícula, uniforme, materiais e pagamento, e o cliente já validou o sistema.
> Executar a limpeza original **destruiria a operação real em andamento**.
>
> A limpeza dos dados de teste **já foi feita manualmente** pelo administrador
> antes da entrada em operação, então o objetivo original desta tarefa está
> cumprido. O que resta é o que nunca foi feito: o dump de segurança e o
> alinhamento do histórico de migrations com a CLI.

Primeira tarefa que toca produção — e agora ela é **não-destrutiva por
construção**: nenhum passo apaga dado.

**Files:** nenhum arquivo do repositório é alterado. O dump é gravado fora do repositório.

**Interfaces:**
- Consumes: as migrations renomeadas da Task 1.
- Produces: um dump restaurável do estado atual e o histórico de migrations reconhecido pela CLI, sem alterar uma única linha de dado. As Tasks 6 e 7 dependem do `repair`.

> **AÇÃO DO USUÁRIO:** fornecer a senha do banco de produção (projeto `jynplnaslifzftyhasna`).

- [ ] **Step 1: Linkar a CLI ao projeto de produção**

```bash
npx supabase link --project-ref jynplnaslifzftyhasna
```

- [ ] **Step 2: Gerar o dump de segurança da operação real**

O plano free não oferece backup restaurável, e produção agora carrega conversas
reais do cliente. Este arquivo é a única rede de proteção que existe.

O dump precisa incluir os dados, não apenas o schema — `--data-only` gera um
segundo arquivo com o conteúdo das tabelas:

```bash
npx supabase db dump --linked -f ~/wacrm-prod-schema-$(date +%Y%m%d).sql
npx supabase db dump --linked --data-only -f ~/wacrm-prod-dados-$(date +%Y%m%d).sql
ls -lh ~/wacrm-prod-*-$(date +%Y%m%d).sql
```

Esperado: os dois arquivos criados, ambos com tamanho maior que zero, e o de
dados contendo as conversas reais. **Se qualquer um falhar, não prosseguir** —
sem backup, nenhum passo seguinte contra produção se justifica.

- [ ] **Step 3: Registrar o estado atual — a linha de base a ser preservada**

No SQL Editor de produção:

```sql
SELECT
  (SELECT count(*) FROM auth.users)         AS usuarios,
  (SELECT count(*) FROM accounts)           AS contas,
  (SELECT count(*) FROM whatsapp_channels)  AS canais,
  (SELECT count(*) FROM conversations)      AS conversas,
  (SELECT count(*) FROM messages)           AS mensagens;
```

Anotar os números. Em 2026-07-29 o estado era 1 usuário, 1 conta, 1 canal e
conversas reais em andamento; as contagens de conversas e mensagens **crescem**
com o uso do cliente.

Ao contrário da versão original desta tarefa, estes números **não devem ir a
zero** — o Step 5 confere que continuam iguais ou maiores.

- [ ] **Step 4: Nenhuma escrita — confirmar que o `repair` não altera dado**

Não há passo de limpeza nesta tarefa. O único comando que resta (`migration
repair`, no Step 5) escreve exclusivamente na tabela de controle
`supabase_migrations.schema_migrations`, que registra quais migrations já
rodaram. Ele não toca em nenhuma tabela de `public` nem em `auth.users`.

Antes de prosseguir, conferir que o dump do Step 2 existe e tem tamanho maior
que zero. **Se não existir, parar aqui.**

- [ ] **Step 5: Registrar as 43 migrations como já aplicadas**

O schema foi construído por colagem manual no SQL Editor, então o histórico da CLI está vazio e um `db push` tentaria reaplicar tudo.

```bash
npx supabase migration repair --status applied $(ls supabase/migrations | sed 's/_.*//' | tr '\n' ' ')
```

- [ ] **Step 6: Confirmar que a CLI e o banco concordam**

```bash
npx supabase migration list --linked
npx supabase db push --dry-run
```

Esperado: as 43 aparecem como aplicadas em ambos os lados, e o `--dry-run` informa que **não há nada pendente**.

Este é o passo mais importante da tarefa. Se o `--dry-run` ainda listar migrations
a aplicar, o `repair` não pegou — e um `db push` futuro tentaria recriar tabelas
que já existem **e que agora contêm dados reais do cliente**. Não prosseguir para
as tarefas seguintes até que o `--dry-run` venha limpo.

- [ ] **Step 7: Confirmar que nada foi perdido**

Repetir a consulta do Step 3 e comparar com os números anotados:

```sql
SELECT
  (SELECT count(*) FROM auth.users)         AS usuarios,
  (SELECT count(*) FROM accounts)           AS contas,
  (SELECT count(*) FROM whatsapp_channels)  AS canais,
  (SELECT count(*) FROM conversations)      AS conversas,
  (SELECT count(*) FROM messages)           AS mensagens;
```

Esperado: valores **iguais ou maiores** que os do Step 3 (podem ter crescido se
o cliente recebeu mensagens durante a tarefa). Qualquer contagem menor indica
perda de dado e exige restauração imediata a partir do dump do Step 2.

---

### Task 6: Migrar o deploy de produção para a branch `production`

> ⚠️ **REESCRITA EM 2026-07-30.** A versão original criava a conta proprietária
> num banco vazio. Isso **já aconteceu**: a conta `ramon.p.paula@gmail.com`
> existe como `owner` e o sistema está em operação.
>
> O que resta é diferente e mais delicado: o deploy que está no ar hoje foi
> feito por **upload direto do diretório local** (`vercel deploy --prod`), sem
> nenhuma branch de git associada — confirmado via `vercel inspect`. A partir da
> Task 3 a Vercel passa a construir a partir do Git, e é preciso provar que o
> build a partir da branch `production` produz o mesmo resultado que está
> servindo o cliente agora.

**Files:** nenhum arquivo do repositório é alterado.

**Interfaces:**
- Consumes: a branch `production` da Task 3; o `migration repair` da Task 5.
- Produces: produção servida a partir da branch `production`, com paridade comprovada em relação ao deploy atual.

> ⚠️ **JANELA DE BAIXO MOVIMENTO.** Esta tarefa republica produção enquanto o
> cliente usa o sistema. Mesmo que o código seja idêntico, um deploy troca as
> instâncias que atendem as requisições. Executar preferencialmente fora do
> horário de atendimento da escola, e nunca durante uma apresentação.

- [ ] **Step 1: Confirmar as variáveis de produção**

```bash
npx vercel --token $VERCEL_TOKEN env ls | grep Production
```

Esperado: as sete variáveis presentes para `Production`, com `NEXT_PUBLIC_SUPABASE_URL` ainda apontando para `jynplnaslifzftyhasna` e a `ENCRYPTION_KEY` **inalterada**, conforme as Global Constraints.

- [ ] **Step 2: Publicar a branch `production`**

```bash
git checkout production
npx vercel --token $VERCEL_TOKEN deploy --prod --yes
```

Esperado: build concluído e `readyState: READY`.

- [ ] **Step 3: Confirmar que a aplicação responde publicamente**

```bash
curl -s -o /dev/null -w "HTTP %{http_code}\n" https://wacrm-ramonppaula-5619s-projects.vercel.app/login
```

Esperado: `HTTP 200`. Um `302` para `vercel.com/sso-api` indicaria proteção de deploy reativada, o que bloquearia também o webhook da UAZAPI.

- [ ] **Step 4: Confirmar que a conta proprietária segue intacta**

O cadastro do proprietário já foi feito. Este passo apenas verifica que o deploy
não afetou nada. No SQL Editor de produção:

```sql
SELECT u.email, p.account_role, a.name AS conta
FROM auth.users u
JOIN profiles p ON p.user_id = u.id
JOIN accounts  a ON a.id = p.account_id;
```

Esperado: uma linha, `ramon.p.paula@gmail.com` com `account_role = 'owner'`.

A transferência de propriedade para a escola fica para o momento da entrega, via
`/api/account/transfer-ownership` — o papel `owner` não pode ser concedido por
convite (`supabase/migrations/017_account_sharing.sql:94`).

- [ ] **Step 5: Confirmar que o canal em operação não foi afetado**

Um deploy não deveria mexer no canal, mas é o ativo mais crítico e a verificação
custa nada:

```sql
SELECT label, phone_e164, status, webhook_registered_at, last_error
FROM whatsapp_channels;
```

Esperado: o canal "Instituto Emanuel" (`553189891123`) segue `connected`, com
`webhook_registered_at` preenchido e `last_error` nulo. Em seguida, pedir ao
cliente uma mensagem de teste, ou enviar uma de um número próprio, e confirmar
que ela chega no inbox.

---

### Task 7: Adicionar o segundo canal UAZAPI de produção

> ⚠️ **REESCRITA EM 2026-07-30.** A versão original conectava dois canais num
> ambiente zerado. **O primeiro canal já está conectado e em operação real:**
> "Instituto Emanuel" (`553189891123`), recebendo mensagens de pais.
>
> **NÃO remover, reconectar ou recadastrar o canal existente.** Remover um canal
> dispara `mergeOrphanedConversations` e transforma as conversas em histórico
> órfão (`channel_id` nulo). A tarefa agora é puramente aditiva.

**Files:** nenhum arquivo do repositório é alterado.

**Interfaces:**
- Consumes: a conta proprietária confirmada na Task 6.
- Produces: produção atendendo os dois números do cliente. Encerra o plano.

> **AÇÃO DO USUÁRIO:** criar no painel da UAZAPI a **segunda** instância de
> produção, com o segundo número da escola. Ela não pode ser a instância de
> homologação da Task 4, nem a que já atende `553189891123`.
>
> Se o segundo número ainda não existir, **esta tarefa pode ser adiada sem
> bloquear nada** — o plano se encerra funcionalmente na Task 6, e o segundo
> canal entra quando o cliente disponibilizar a linha.

- [ ] **Step 1: Registrar o estado antes de mexer**

```sql
SELECT id, label, phone_e164, status, webhook_registered_at
FROM whatsapp_channels;
```

Esperado: uma linha, o canal em operação. Anotar o `id` — ele **não pode**
mudar até o fim da tarefa.

- [ ] **Step 2: Cadastrar apenas o segundo canal**

Em produção, acessar *Configurações → WhatsApp → Adicionar canal*, informar URL
base e token da **segunda** instância e conectar por QR Code. Não encostar no
canal já existente.

- [ ] **Step 3: Confirmar que agora há dois, e que o primeiro está intacto**

```sql
SELECT id, label, phone_e164, status, webhook_registered_at, last_error
FROM whatsapp_channels
ORDER BY webhook_registered_at;
```

Esperado: duas linhas, ambas `connected`, ambas com `webhook_registered_at`
preenchido e `last_error` nulo — e o `id` anotado no Step 1 presente e
inalterado.

- [ ] **Step 4: Validar o recebimento em ambos os números**

Enviar uma mensagem de teste para cada um dos dois números e conferir:

```sql
SELECT ch.label, m.content_text, m.created_at
FROM messages m
JOIN conversations c  ON c.id = m.conversation_id
JOIN whatsapp_channels ch ON ch.id = c.channel_id
ORDER BY m.created_at DESC
LIMIT 10;
```

Esperado: as duas mensagens aparecem, cada uma associada ao seu respectivo canal.

- [ ] **Step 5: Reconfirmar o isolamento na direção oposta**

Anotar a contagem atual de mensagens em produção, enviar uma mensagem para o
número de **homologação** e verificar que ela não chega em produção:

```sql
SELECT count(*) FROM messages;
```

Esperado: nenhuma mensagem nova **atribuível ao teste de homologação**. Atenção:
produção está em operação real, então a contagem pode ter crescido por mensagens
legítimas de pais no intervalo. A conferência correta é pelo conteúdo:

```sql
SELECT ch.label, m.content_text, m.created_at
FROM messages m
JOIN conversations c ON c.id = m.conversation_id
LEFT JOIN whatsapp_channels ch ON ch.id = c.channel_id
WHERE m.created_at > now() - interval '10 minutes'
ORDER BY m.created_at DESC;
```

Esperado: a mensagem de teste enviada a homologação **não** aparece nesta lista.
Somada ao Step 5 da Task 4, fecha os dois sentidos do isolamento.

- [ ] **Step 6: Registrar o procedimento de backup manual**

O plano free não oferece backup restaurável, e produção agora carrega dado real.
Executar os dois dumps e guardá-los fora da plataforma:

```bash
npx supabase db dump --linked -f ~/wacrm-prod-schema-$(date +%Y%m%d).sql
npx supabase db dump --linked --data-only -f ~/wacrm-prod-dados-$(date +%Y%m%d).sql
```

Repetir antes de cada migration futura em produção e periodicamente durante a
operação, conforme a §8 do spec. Enquanto o projeto estiver no plano free, este
é o único caminho de restauração que existe.

---

## Apêndice: WhatsApp no ambiente de dev (sob demanda)

O spec prevê uma quarta instância UAZAPI para dev (§3), mas ela **não faz parte
do caminho crítico** — só é necessária quando houver desenvolvimento local que
dependa de receber mensagens de verdade. Deixá-la fora das tarefas evita montar
infraestrutura que pode ficar ociosa.

Quando for preciso, o procedimento é:

1. Criar uma instância UAZAPI dedicada a dev, distinta das de produção e da de
   homologação.
2. Expor o `localhost:3000` com um túnel, já que a UAZAPI não alcança a máquina
   local:

```bash
cloudflared tunnel --url http://localhost:3000
```

3. Colocar a URL do túnel em `NEXT_PUBLIC_SITE_URL` no `.env.local` e reiniciar
   o `npm run dev`, para que `getBaseUrl` registre o webhook num endereço
   alcançável.
4. Cadastrar o canal normalmente pela tela de Configurações.

A URL do túnel muda a cada execução, então o canal precisa ser reconectado a
cada nova sessão de trabalho — motivo pelo qual isso não vira rotina fixa.

## Verificação final — critérios de aceitação do spec

Rodar ao fim do plano (a Task 7 pode ficar pendente se o segundo número não existir ainda) e conferir cada item:

- [ ] Mensagem enviada à instância de homologação aparece no banco compartilhado de homologação-e-dev e **não** em produção (Task 4 Step 5, Task 7 Step 5)
- [ ] O canal em operação (`553189891123`) segue recebendo mensagens reais após todo deploy e após qualquer publicação em `staging` (Task 6 Step 5, Task 7 Step 3)
- [ ] `npx supabase db push` aplica as 43 migrations sem erro num projeto novo (Task 2 Step 3) — o teste de validade que antes dependia de um `db reset` local
- [ ] `npx supabase db push --dry-run` em produção informa que não há nada pendente (Task 5 Step 6)
- [ ] `npx supabase db push` aplica migration nova em homologação sem afetar produção (Task 2)
- [ ] Nenhuma contagem de dado em produção diminuiu ao longo do plano (Task 5 Step 7, Task 6 Step 4)
- [ ] `.env.local` aponta para o projeto de homologação-e-dev, não para produção (Task 2 Step 8)
- [ ] A `ENCRYPTION_KEY` usada em `.env.local` (Task 2) é idêntica à configurada no ambiente Preview da Vercel (Task 3) — caso contrário, tokens gravados por um lado ficam ilegíveis pelo outro
- [ ] Existem dumps de schema e de dados de produção guardados fora da plataforma (Task 5 Step 2)

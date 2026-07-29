# Separação em Três Ambientes — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Isolar dev, homologação e produção em bancos Supabase e instâncias UAZAPI próprios, com migrations aplicadas pela Supabase CLI, de modo que nenhuma evolução do sistema toque em dados de produção.

**Architecture:** Três ambientes, cada um com seu banco e sua instância UAZAPI. Dev roda Supabase local em Docker; homologação e produção são projetos na nuvem. As branches `staging` e `production` mapeiam para os dois ambientes remotos na Vercel, enquanto `main` permanece espelhando o projeto open-source upstream. A produção é a última coisa tocada, e tudo que acontece nela já terá sido ensaiado em dev e homologação.

**Tech Stack:** Supabase CLI 2.110.0, Docker, Vercel CLI 58.1.0, Next.js 16.2.12, PostgreSQL, UAZAPI.

**Spec:** `docs/superpowers/specs/2026-07-29-tres-ambientes-design.md`

## Global Constraints

- `supabase db reset` é destrutivo e só pode ser executado contra o banco **local**. Nunca contra homologação ou produção.
- Nenhuma tarefa altera `main` nem os PRs de terceiros do projeto upstream (`ArnasDon/wacrm`).
- A `ENCRYPTION_KEY` de produção **não muda** — ela decifra tokens UAZAPI já gravados. Dev e homologação recebem chaves novas e distintas.
- `NEXT_PUBLIC_SITE_URL` fica **vazio** no ambiente Preview da Vercel; `getBaseUrl` resolve pelo cabeçalho `x-forwarded-host`.
- A `SUPABASE_SERVICE_ROLE_KEY` de um ambiente nunca é usada em outro.
- Produção só é tocada a partir da Task 6. As Tasks 0–5 não têm risco sobre ela.
- Toda operação destrutiva em produção exige o dump da Task 6 concluído antes.
- Nenhum dado de seed é criado: os ambientes começam vazios por decisão explícita.

## Ações que exigem o usuário

Estas etapas não podem ser executadas por um agente e estão sinalizadas dentro das tarefas:

| Ação | Task |
|---|---|
| Abrir o Docker Desktop | 2 |
| Criar o projeto Supabase de homologação e fornecer a senha do banco | 3 |
| Fornecer a senha do banco de produção | 6 |
| Criar 1 instância UAZAPI de homologação | 5 |
| Criar/confirmar 2 instâncias UAZAPI de produção | 8 |
| Fazer o primeiro cadastro em produção (vira proprietário) | 7 |

**Sobre `$VERCEL_TOKEN`:** os comandos das Tasks 4 e 7 usam essa variável. Ela é o token da Vercel, e deve ser exportada na sessão do shell antes de rodá-los (`export VERCEL_TOKEN=<token>`), nunca escrita em arquivo versionado. O mesmo vale para as chaves `service_role` — elas aparecem apenas como argumento de comando, jamais commitadas.

---

### Task 0: Descartar os resíduos da tentativa de deploy no Cloudflare

O working tree carrega arquivos de uma tentativa abandonada de deploy via
Cloudflare Workers. Nada disso está commitado, e a Task 4 cria branches a partir
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
— o que importa porque, a partir da Task 4, a Vercel passa a construir a partir
do Git, e não mais do upload do diretório local.

Não há commit nesta tarefa: ela apenas descarta o que nunca foi versionado.

---

### Task 1: Inicializar a Supabase CLI e renomear as 43 migrations

A CLI exige nomes no formato `<timestamp de 14 dígitos>_nome.sql`. As atuais usam `001_`, `002_`, e a CLI as ignora por completo.

**Files:**
- Create: `supabase/config.toml`
- Rename: os 43 arquivos de `supabase/migrations/`

**Interfaces:**
- Produces: migrations nomeadas `20250101000001_initial_schema.sql` … `20250101000043_notifications_pt_br.sql`, na mesma ordem lógica de hoje. As Tasks 2, 3 e 6 dependem desses nomes.

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

### Task 2: Supabase local no ar, validando as 43 migrations do zero

Este é o teste mais valioso do plano: se alguma das 43 migrations não roda a partir de um banco vazio, o problema aparece aqui, num banco descartável, e não em produção.

**Files:**
- Modify: `.env.local`
- Modify: `.gitignore` (se `.env.local` ainda não estiver ignorado)

**Interfaces:**
- Consumes: as migrations renomeadas na Task 1.
- Produces: ambiente de dev apontando para o Supabase local; nenhuma outra task depende dele.

> **AÇÃO DO USUÁRIO:** abrir o Docker Desktop e aguardar o daemon iniciar. O Docker já está instalado (v29.1.2), apenas parado.

- [ ] **Step 1: Confirmar que o Docker responde**

```bash
docker ps
```

Esperado: uma tabela de containers (possivelmente vazia). Se retornar erro de pipe/daemon, o Docker Desktop ainda não subiu.

- [ ] **Step 2: Subir o Supabase local**

```bash
npx supabase start
```

A primeira execução baixa várias imagens e pode levar alguns minutos. Ao final imprime `API URL`, `anon key` e `service_role key` — esses valores são usados no Step 5.

- [ ] **Step 3: Validar as 43 migrations a partir de um banco vazio**

```bash
npx supabase db reset
```

Esperado: a CLI recria o banco e aplica as 43 em sequência, imprimindo cada uma. **Qualquer erro aqui é um defeito real numa migration** e deve ser corrigido antes de prosseguir — o mesmo erro apareceria em qualquer banco novo, incluindo o de homologação da Task 3.

- [ ] **Step 4: Confirmar que a CLI registrou as 43**

```bash
npx supabase migration list --local
```

Esperado: 43 linhas, todas com a coluna `Local` e `Remote` coerentes para o ambiente local.

- [ ] **Step 5: Apontar o dev local para o banco local**

Recuperar as credenciais:

```bash
npx supabase status
```

Escrever `.env.local` com os valores impressos (a `API URL` costuma ser `http://127.0.0.1:54321`):

```
NEXT_PUBLIC_SUPABASE_URL=<API URL do supabase status>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key do supabase status>
SUPABASE_SERVICE_ROLE_KEY=<service_role key do supabase status>
ENCRYPTION_KEY=<gerar novo, ver Step 6>
META_APP_SECRET=nao-usado-em-dev
NEXT_PUBLIC_SITE_URL=http://localhost:3000
NEXT_PUBLIC_APP_LOCALE=pt
```

- [ ] **Step 6: Gerar uma ENCRYPTION_KEY própria para dev**

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Usar a saída no `.env.local`. Esta chave é distinta da de produção por construção — nunca copiar a de produção para cá.

- [ ] **Step 7: Confirmar que `.env.local` não vai para o git**

```bash
git check-ignore .env.local && echo "IGNORADO (correto)" || echo "PERIGO: seria commitado"
```

Se não estiver ignorado, acrescentar `.env.local` ao `.gitignore` antes de qualquer commit.

- [ ] **Step 8: Subir a aplicação e validar o cadastro**

```bash
npm run dev
```

No navegador, acessar `http://localhost:3000/signup` e criar uma conta de teste.

Esperado: o cadastro conclui e a aplicação abre autenticada. Isso exercita o trigger `on_auth_user_created` → `handle_new_user()` (`supabase/migrations/001_initial_schema.sql:400`), que cria conta e perfil. **Se falhar aqui, o mesmo aconteceria em produção depois da limpeza da Task 6** — investigar antes de seguir.

- [ ] **Step 9: Confirmar no banco que conta e perfil nasceram**

No SQL do Studio local (`http://127.0.0.1:54323`), rodar:

```sql
SELECT
  (SELECT count(*) FROM auth.users)  AS usuarios,
  (SELECT count(*) FROM accounts)    AS contas,
  (SELECT count(*) FROM profiles)    AS perfis;
```

Esperado: `1, 1, 1`. Qualquer zero indica que o trigger não disparou.

- [ ] **Step 10: Commit**

Nada de segredo entra no commit — apenas a eventual linha do `.gitignore`.

```bash
git add .gitignore
git commit -m "chore(dev): garante que .env.local fique fora do versionamento"
```

Se o `.gitignore` já cobria o arquivo, não há o que commitar nesta task e o passo é dispensado.

---

### Task 3: Projeto Supabase de homologação com as migrations aplicadas

**Files:** nenhum arquivo do repositório é alterado. A tarefa produz infraestrutura remota.

**Interfaces:**
- Consumes: as migrations renomeadas na Task 1, validadas na Task 2.
- Produces: URL, anon key e service_role key de homologação, consumidos pela Task 4.

> **AÇÃO DO USUÁRIO:** criar um projeto novo no painel do Supabase (nome sugerido: `wacrm-homologacao`), na mesma organização ou em outra, e guardar a senha do banco definida na criação. Anotar também o *project ref* (a sequência de caracteres na URL do projeto).

- [ ] **Step 1: Linkar a CLI ao projeto de homologação**

```bash
npx supabase link --project-ref <ref-de-homologacao>
```

A CLI pedirá a senha do banco definida na criação do projeto.

- [ ] **Step 2: Conferir o que seria aplicado, sem aplicar**

```bash
npx supabase db push --dry-run
```

Esperado: a lista das 43 migrations como pendentes. O banco é novo e está vazio, portanto **não** se usa `migration repair` aqui — `repair` é exclusivo da Task 6, onde o schema já existe.

- [ ] **Step 3: Aplicar as migrations**

```bash
npx supabase db push
```

Esperado: as 43 aplicam sem erro, na mesma sequência já validada localmente na Task 2.

- [ ] **Step 4: Confirmar o histórico remoto**

```bash
npx supabase migration list --linked
```

Esperado: as 43 aparecem com versão local e remota correspondentes.

- [ ] **Step 5: Confirmar que o banco de homologação nasceu vazio de dados**

No SQL Editor do projeto de homologação:

```sql
SELECT
  (SELECT count(*) FROM auth.users)         AS usuarios,
  (SELECT count(*) FROM accounts)           AS contas,
  (SELECT count(*) FROM whatsapp_channels)  AS canais,
  (SELECT count(*) FROM conversations)      AS conversas;
```

Esperado: `0, 0, 0, 0` — schema presente, dados ausentes.

- [ ] **Step 6: Registrar as credenciais de homologação**

No painel do projeto, em *Project Settings → API*, copiar a *Project URL*, a chave `anon` e a chave `service_role`. A Task 4 consome esses três valores. Não commitar nada disso.

---

### Task 4: Branches `staging`/`production` e variáveis isoladas na Vercel

Hoje `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` estão configuradas para *Production, Preview e Development* com **o mesmo valor** — é literalmente o defeito que motivou este plano: qualquer preview escreve no banco de produção.

**Files:** nenhum arquivo do repositório é alterado.

**Interfaces:**
- Consumes: as credenciais de homologação da Task 3.
- Produces: branch `production` como origem do deploy de produção e `staging` como ambiente de homologação com URL estável. A Task 5 depende da URL de `staging`; a Task 7 depende de `production`.

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

Gerar uma `ENCRYPTION_KEY` exclusiva de homologação e registrá-la:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
npx vercel --token $VERCEL_TOKEN env add ENCRYPTION_KEY preview --value "<chave gerada>" --yes
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

Anotar a URL de branch (formato `wacrm-git-staging-<team>.vercel.app`), que é estável entre deploys. A Task 5 registra o webhook contra ela.

- [ ] **Step 7: Provar que homologação escreve no banco certo**

Acessar a URL de `staging`, criar uma conta de teste e conferir no SQL Editor **do projeto de homologação**:

```sql
SELECT count(*) FROM auth.users;
```

Esperado: `1`. Em seguida, rodar a mesma consulta no **banco de produção**: o número de usuários lá **não pode** ter mudado. Esta é a primeira prova concreta do isolamento.

---

### Task 5: Instância UAZAPI de homologação e prova de isolamento do WhatsApp

Esta é a tarefa que valida o risco central do spec: a instância UAZAPI aceita **um único webhook por vez**, e `registerUazapiWebhook` sobrescreve a configuração (`src/lib/whatsapp/uazapi/register-webhook.ts:17-19`).

**Files:** nenhum arquivo do repositório é alterado.

**Interfaces:**
- Consumes: a URL estável de `staging` da Task 4.
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

Se a instância de produção tiver perdido o webhook, alguma credencial foi reaproveitada — **parar e corrigir antes da Task 6**, porque significa que o isolamento não existe.

---

### Task 6: Dump de segurança, limpeza de produção e `migration repair`

Primeira tarefa que toca produção. O banco contém apenas dados de teste e será zerado por completo, incluindo contas de usuário.

**Files:** nenhum arquivo do repositório é alterado. O dump é gravado fora do repositório.

**Interfaces:**
- Consumes: as migrations renomeadas da Task 1.
- Produces: banco de produção vazio, com schema intacto e histórico de migrations reconhecido pela CLI. As Tasks 7 e 8 dependem disso.

> **AÇÃO DO USUÁRIO:** fornecer a senha do banco de produção (projeto `jynplnaslifzftyhasna`).

- [ ] **Step 1: Linkar a CLI ao projeto de produção**

```bash
npx supabase link --project-ref jynplnaslifzftyhasna
```

- [ ] **Step 2: Gerar o dump de segurança antes de qualquer escrita**

O plano free não oferece backup restaurável; este arquivo é a única rede de proteção.

```bash
npx supabase db dump --linked -f ~/wacrm-producao-antes-da-limpeza.sql
ls -lh ~/wacrm-producao-antes-da-limpeza.sql
```

Esperado: arquivo criado com tamanho maior que zero. **Se o dump falhar, não prosseguir.**

- [ ] **Step 3: Registrar o estado anterior para conferência posterior**

No SQL Editor de produção:

```sql
SELECT
  (SELECT count(*) FROM auth.users)         AS usuarios,
  (SELECT count(*) FROM accounts)           AS contas,
  (SELECT count(*) FROM whatsapp_channels)  AS canais,
  (SELECT count(*) FROM conversations)      AS conversas,
  (SELECT count(*) FROM messages)           AS mensagens;
```

Anotar os números — o Step 6 confere que todos foram a zero.

- [ ] **Step 4: Apagar os dados de `public`**

`accounts.owner_user_id` usa `ON DELETE RESTRICT` (`supabase/migrations/017_account_sharing.sql:66`), então apagar `auth.users` primeiro falharia. O truncamento de `public` vem antes, por isso.

O comando é dinâmico para não depender de uma lista manual de tabelas, que ficaria desatualizada:

```sql
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE format('TRUNCATE TABLE public.%I CASCADE', r.tablename);
  END LOOP;
END $$;
```

Isso preserva tabelas, colunas, triggers e políticas de RLS — apenas as linhas saem.

- [ ] **Step 5: Apagar os usuários e a mídia órfã**

Com `public` vazio, nada mais referencia `auth.users` e o `RESTRICT` deixa de bloquear:

```sql
DELETE FROM auth.users;

DELETE FROM storage.objects
WHERE bucket_id IN ('avatars', 'flow-media', 'chat-media');
```

Os três buckets em si são preservados: eles são criados pelas migrations 008, 016 e 023 e continuam existindo, apenas sem arquivos.

- [ ] **Step 6: Confirmar que o banco está vazio e o schema intacto**

```sql
SELECT
  (SELECT count(*) FROM auth.users)         AS usuarios,
  (SELECT count(*) FROM accounts)           AS contas,
  (SELECT count(*) FROM whatsapp_channels)  AS canais,
  (SELECT count(*) FROM conversations)      AS conversas,
  (SELECT count(*) FROM messages)           AS mensagens,
  (SELECT count(*) FROM pg_tables WHERE schemaname='public') AS tabelas;
```

Esperado: todas as contagens de dados em `0`, e `tabelas` com o mesmo número de antes da limpeza — schema preservado.

- [ ] **Step 7: Registrar as 43 migrations como já aplicadas**

O schema foi construído por colagem manual no SQL Editor, então o histórico da CLI está vazio e um `db push` tentaria reaplicar tudo.

```bash
npx supabase migration repair --status applied $(ls supabase/migrations | sed 's/_.*//' | tr '\n' ' ')
```

- [ ] **Step 8: Confirmar que a CLI e o banco concordam**

```bash
npx supabase migration list --linked
npx supabase db push --dry-run
```

Esperado: as 43 aparecem como aplicadas em ambos os lados, e o `--dry-run` informa que **não há nada pendente**. Se ele ainda listar migrations a aplicar, o `repair` não pegou e reaplicá-las sobre um schema existente causaria erro.

---

### Task 7: Deploy da branch `production` e primeiro cadastro

**Files:** nenhum arquivo do repositório é alterado.

**Interfaces:**
- Consumes: banco de produção limpo da Task 6; branch `production` da Task 4.
- Produces: produção no ar com uma conta proprietária. A Task 8 depende dessa conta para cadastrar os canais.

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

> **AÇÃO DO USUÁRIO:** acessar `/signup` em produção e criar a conta. Quem fizer este cadastro torna-se **proprietário** da conta — o papel `owner` não pode ser concedido por convite (`supabase/migrations/017_account_sharing.sql:94`), apenas por este cadastro inicial ou por transferência posterior via `/api/account/transfer-ownership`.

- [ ] **Step 4: Confirmar que conta e perfil foram criados**

No SQL Editor de produção:

```sql
SELECT u.email, p.account_role, a.name AS conta
FROM auth.users u
JOIN profiles p ON p.user_id = u.id
JOIN accounts  a ON a.id = p.account_id;
```

Esperado: uma linha, com `account_role = 'owner'`.

---

### Task 8: Reconectar as instâncias UAZAPI de produção

**Files:** nenhum arquivo do repositório é alterado.

**Interfaces:**
- Consumes: a conta proprietária da Task 7.
- Produces: produção recebendo mensagens nos dois números do cliente. Encerra o plano.

> **AÇÃO DO USUÁRIO:** confirmar no painel da UAZAPI as **duas** instâncias de produção (uma delas é a que já atendia o número +553183839660). Nenhuma delas pode ser a instância de homologação da Task 5.

- [ ] **Step 1: Cadastrar o primeiro canal**

Em produção, acessar *Configurações → WhatsApp → Adicionar canal*, informar URL base e token da primeira instância e conectar por QR Code.

- [ ] **Step 2: Cadastrar o segundo canal**

Repetir o processo com a segunda instância. O suporte a múltiplos canais por conta é justamente o que os 38 commits de customização entregaram.

- [ ] **Step 3: Confirmar o registro do webhook nos dois**

```sql
SELECT label, phone_e164, status, webhook_registered_at, last_error
FROM whatsapp_channels;
```

Esperado: duas linhas, ambas `connected`, ambas com `webhook_registered_at` preenchido e `last_error` nulo.

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

Enviar uma mensagem para o número de **homologação** e verificar que ela **não** chega em produção:

```sql
SELECT count(*) FROM messages;
```

Esperado: contagem inalterada em produção. Somada ao Step 5 da Task 5, esta verificação fecha os dois sentidos do isolamento.

- [ ] **Step 6: Registrar o procedimento de backup manual**

O plano free não oferece backup restaurável. Executar um dump e guardá-lo fora da plataforma:

```bash
npx supabase db dump --linked -f ~/wacrm-producao-$(date +%Y%m%d).sql
```

Repetir antes de cada migration futura em produção e periodicamente durante a operação, conforme a §8 do spec.

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

Rodar após a Task 8 e conferir cada item:

- [ ] Mensagem enviada à instância de homologação aparece no banco de homologação e **não** em produção (Task 5 Step 5, Task 8 Step 5)
- [ ] Mensagem enviada às instâncias de produção chega em produção mesmo após deploy em `staging` (Task 8 Step 4)
- [ ] `npx supabase db reset` no local recria as 43 migrations sem erro (Task 2 Step 3)
- [ ] `npx supabase db push` aplica migration nova em um ambiente sem afetar os demais (Tasks 3 e 6)
- [ ] Deploy em `production` preserva os dados existentes (Task 7 Step 2, conferido no Step 4)
- [ ] Primeiro cadastro em produção cria conta e perfil, e o acesso funciona (Task 7 Step 4)

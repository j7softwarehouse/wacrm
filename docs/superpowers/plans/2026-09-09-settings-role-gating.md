# Controle de Acesso por Seção em Configurações — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Impedir que os papéis `agent` e `viewer` vejam ou acessem — pela
tela e pela API — as seções de Configurações que expõem dados sensíveis de
WhatsApp, com `agent` perdendo só WhatsApp+Grupos e `viewer` perdendo todo
o espaço de trabalho.

**Architecture:** Um campo `minRole` novo em `SectionMeta`
(`settings-sections.ts`) e uma função pura `canAccessSection(section, role)`
alimentam dois pontos de aplicação já existentes na tela (o filtro de
`SettingsRail` e o redirect de `SettingsPageInner`, ambos generalizando um
padrão que já existe hoje para o módulo de vendas). No backend, cinco rotas
de leitura sem checagem de papel ganham uma checagem explícita admin+,
usando o padrão já estabelecido em rotas irmãs do mesmo arquivo (ou
`requireRole` onde já é a convenção do arquivo).

**Tech Stack:** Next.js App Router, TypeScript, Supabase, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-09-settings-role-gating-design.md`

## Global Constraints

- Modelo de `minRole` por seção (spec seção 4): `overview`/`profile`/
  `security`/`appearance` → `viewer`; `whatsapp`/`groups` → `admin`;
  `templates`/`quick-replies`/`fields`/`deals`/`members`/`api` → `agent`.
- `accountRole === null` (perfil ainda carregando ou ausente) é tratado
  como `viewer` — falha fechado, nunca libera uma seção antes de saber o
  papel real.
- O redirect em `SettingsPageInner` só pode rodar depois que
  `profileLoading` vira `false` — senão um admin/owner entrando direto em
  `/settings?tab=whatsapp` (link do menu da conta) seria jogado pra Visão
  geral por engano antes do papel carregar (spec seção 5).
- Rotas que NÃO podem ser tocadas neste plano, sob nenhuma circunstância
  (spec seção 6): `GET /api/whatsapp/channels` (lista básica, a Caixa de
  Entrada depende dela) e `POST /api/whatsapp/groups/[id]/open` (botão
  "Conversar", aberto a qualquer membro da conta por design). Uma task
  que mexer nessas duas rotas está errada, não é uma melhoria.
- Rotas que JÁ satisfazem a spec, sem nenhuma mudança necessária: `GET
  /api/whatsapp/channels/[id]/webhook-url` (já usa `requireRole("admin")`)
  e `POST /api/whatsapp/groups/sync` (já usa `canEditSettings`).
- TDD real: RED antes de GREEN, verificado rodando o teste, não assumido.
- Comentários e mensagens de erro em português, seguindo a convenção já
  estabelecida no restante do código deste branch — EXCETO onde o
  arquivo tocado já usa inglês nas mensagens de erro existentes (ex.:
  `config/route.ts`, `config/verify-registration/route.ts`,
  `channels/[id]/status/route.ts` — nesses casos a nova mensagem de erro
  segue o idioma que já está no arquivo, para não misturar idioma na
  mesma rota).
- Nenhum arquivo de teste de componente novo para `settings-rail.tsx` ou
  `page.tsx` — este projeto verifica esse tipo de UI manualmente em
  homolog, não com testes de componente (mesmo padrão já usado em
  `groups-manager.tsx` e `message-composer.tsx`). A lógica de política
  em si (`canAccessSection`) É testada de verdade, isolada como função
  pura — é ela que carrega o risco de segurança, não a JSX que a chama.

---

## Arquivos (mapa)

- Modificar: `src/components/settings/settings-sections.ts` — adiciona
  `minRole` e a função `canAccessSection`.
- Criar: `src/components/settings/settings-sections.test.ts`
- Modificar: `src/components/settings/settings-rail.tsx` — usa
  `canAccessSection` no filtro que já existe.
- Modificar: `src/app/(dashboard)/settings/page.tsx` — usa
  `canAccessSection` no redirect que já existe.
- Modificar: `src/app/api/whatsapp/config/route.ts`
- Criar: `src/app/api/whatsapp/config/route.test.ts`
- Modificar: `src/app/api/whatsapp/config/verify-registration/route.ts`
- Criar: `src/app/api/whatsapp/config/verify-registration/route.test.ts`
- Modificar: `src/app/api/whatsapp/channels/[id]/status/route.ts`
- Criar: `src/app/api/whatsapp/channels/[id]/status/route.test.ts`
- Modificar: `src/app/api/whatsapp/groups/route.ts`
- Criar: `src/app/api/whatsapp/groups/route.test.ts`
- Modificar: `src/app/api/whatsapp/groups/[id]/participants/route.ts`
- Criar: `src/app/api/whatsapp/groups/[id]/participants/route.test.ts`

---

### Task 1: `minRole` por seção + função pura `canAccessSection`

**Files:**
- Modify: `src/components/settings/settings-sections.ts`
- Test: `src/components/settings/settings-sections.test.ts`

**Interfaces:**
- Consumes: `AccountRole`, `hasMinRole` de `@/lib/auth/roles` (já existem,
  sem mudança).
- Produces: `SectionMeta.minRole: AccountRole` (novo campo, em todas as 12
  entradas de `SECTION_META`); `canAccessSection(section: SettingsSection,
  role: AccountRole | null): boolean` (nova função exportada) — Task 2
  consome exatamente essa assinatura.

- [ ] **Step 1: Escrever o teste que falha**

Criar `src/components/settings/settings-sections.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { canAccessSection, SETTINGS_SECTIONS } from './settings-sections';

describe('canAccessSection', () => {
  it('viewer so acessa as secoes pessoais (Conta) e a Visao geral', () => {
    const allowed = SETTINGS_SECTIONS.filter((s) => canAccessSection(s, 'viewer'));

    expect([...allowed].sort()).toEqual(
      ['overview', 'profile', 'security', 'appearance'].sort(),
    );
  });

  it('agent perde WhatsApp e Grupos, mas mantem o resto do espaco de trabalho', () => {
    expect(canAccessSection('whatsapp', 'agent')).toBe(false);
    expect(canAccessSection('groups', 'agent')).toBe(false);

    const restoDoEspacoDeTrabalho = [
      'templates',
      'quick-replies',
      'fields',
      'deals',
      'members',
      'api',
    ] as const;
    for (const s of restoDoEspacoDeTrabalho) {
      expect(canAccessSection(s, 'agent')).toBe(true);
    }
  });

  it('admin e owner acessam todas as secoes', () => {
    for (const s of SETTINGS_SECTIONS) {
      expect(canAccessSection(s, 'admin')).toBe(true);
      expect(canAccessSection(s, 'owner')).toBe(true);
    }
  });

  it('papel nulo (perfil ainda carregando ou ausente) e tratado como viewer — falha fechado', () => {
    expect(canAccessSection('whatsapp', null)).toBe(false);
    expect(canAccessSection('groups', null)).toBe(false);
    expect(canAccessSection('templates', null)).toBe(false);
    expect(canAccessSection('overview', null)).toBe(true);
    expect(canAccessSection('profile', null)).toBe(true);
  });
});
```

- [ ] **Step 2: Rodar o teste, confirmar que falha**

Run: `npx vitest run src/components/settings/settings-sections.test.ts`
Expected: FAIL — `canAccessSection` não existe (`is not exported` ou
`is not a function`), e `SectionMeta`/`SECTION_META` ainda não têm
`minRole`.

- [ ] **Step 3: Implementar**

Ler o arquivo atual primeiro (`src/components/settings/settings-sections.ts`)
— ele tem 88 linhas. Duas mudanças:

**3a.** Adicionar o import de `AccountRole`/`hasMinRole` no topo do
arquivo, junto dos imports de ícones já existentes:

```ts
import {
  Coins,
  FileText,
  KeyRound,
  LayoutGrid,
  Palette,
  PlugZap,
  Shield,
  Tags,
  User,
  Users,
  UsersRound,
  Zap,
  type LucideIcon,
} from 'lucide-react';

import { hasMinRole, type AccountRole } from '@/lib/auth/roles';
```

**3b.** Substituir a interface `SectionMeta` e o objeto `SECTION_META`
inteiros (a partir de `/** Rail grouping. \`adminOnly\` items are hidden
for non-admins. */` até o fechamento do objeto) por:

```ts
/**
 * Rail grouping + controle de acesso por papel.
 *
 * `minRole` decide se a seção aparece no rail (`SettingsRail`) e se a
 * URL `?tab=` correspondente é aceita (`SettingsPageInner`) — ver
 * `canAccessSection` abaixo e
 * docs/superpowers/specs/2026-09-09-settings-role-gating-design.md.
 */
export interface SectionMeta {
  id: SettingsSection;
  label: string;
  icon: LucideIcon;
  group: 'top' | 'account' | 'workspace';
  minRole: AccountRole;
}

export const SECTION_META: Record<SettingsSection, SectionMeta> = {
  overview: { id: 'overview', label: 'Overview', icon: LayoutGrid, group: 'top', minRole: 'viewer' },
  profile: { id: 'profile', label: 'Your profile', icon: User, group: 'account', minRole: 'viewer' },
  security: { id: 'security', label: 'Login & security', icon: Shield, group: 'account', minRole: 'viewer' },
  appearance: { id: 'appearance', label: 'Appearance', icon: Palette, group: 'account', minRole: 'viewer' },
  whatsapp: { id: 'whatsapp', label: 'WhatsApp', icon: PlugZap, group: 'workspace', minRole: 'admin' },
  groups: { id: 'groups', label: 'Groups', icon: Users, group: 'workspace', minRole: 'admin' },
  templates: { id: 'templates', label: 'Templates', icon: FileText, group: 'workspace', minRole: 'agent' },
  'quick-replies': { id: 'quick-replies', label: 'Quick replies', icon: Zap, group: 'workspace', minRole: 'agent' },
  fields: { id: 'fields', label: 'Fields & tags', icon: Tags, group: 'workspace', minRole: 'agent' },
  deals: { id: 'deals', label: 'Deals & currency', icon: Coins, group: 'workspace', minRole: 'agent' },
  members: { id: 'members', label: 'Team members', icon: UsersRound, group: 'workspace', minRole: 'agent' },
  api: { id: 'api', label: 'API keys', icon: KeyRound, group: 'workspace', minRole: 'agent' },
};

/**
 * True quando `role` alcança o `minRole` da seção. `role === null`
 * (perfil ainda carregando, ou perfil ausente) é tratado como `viewer`
 * — o papel de menor privilégio — para nunca liberar uma seção sensível
 * antes de saber o papel real do usuário.
 */
export function canAccessSection(
  section: SettingsSection,
  role: AccountRole | null,
): boolean {
  return hasMinRole(role ?? 'viewer', SECTION_META[section].minRole);
}
```

Note: a interface anterior tinha um comentário dizendo que existia um
campo `adminOnly` — isso nunca foi implementado (é só comentário morto).
`minRole` substitui essa ideia por completo.

- [ ] **Step 4: Rodar o teste, confirmar que passa**

Run: `npx vitest run src/components/settings/settings-sections.test.ts`
Expected: PASS — 4 testes.

- [ ] **Step 5: Rodar `tsc` e o lint no arquivo**

Run: `npx tsc --noEmit`
Expected: sem erros novos (`SECTION_META` ganhou um campo obrigatório em
todas as 12 entradas — se algum outro arquivo desestruturar `SectionMeta`
com um tipo literal mais estreito, o `tsc` aponta aqui).

Run: `npx eslint src/components/settings/settings-sections.ts src/components/settings/settings-sections.test.ts`
Expected: sem erros.

- [ ] **Step 6: Commit**

```bash
git add src/components/settings/settings-sections.ts src/components/settings/settings-sections.test.ts
git commit -m "feat(settings): minRole por secao + canAccessSection"
```

---

### Task 2: Aplicar `canAccessSection` no rail e no redirect da página

**Files:**
- Modify: `src/components/settings/settings-rail.tsx`
- Modify: `src/app/(dashboard)/settings/page.tsx`

**Interfaces:**
- Consumes: `canAccessSection(section, role)` da Task 1;
  `useAuth().accountRole: AccountRole | null` e
  `useAuth().profileLoading: boolean` (já existem em
  `src/hooks/use-auth.tsx`, sem mudança necessária nesse hook).
- Produces: nada consumido por tasks seguintes — esta é a última peça do
  lado do frontend.

- [ ] **Step 1: Modificar `settings-rail.tsx`**

Ler o arquivo atual primeiro. Duas mudanças:

**1a.** No import de `./settings-sections`, adicionar `canAccessSection`:

```tsx
import {
  RAIL_GROUPS,
  SECTION_META,
  SETTINGS_SECTIONS,
  canAccessSection,
  type SettingsSection,
} from './settings-sections';
```

**1b.** Dentro de `SettingsRail`, ler `accountRole` de `useAuth()` (a
linha já existente `const { salesEnabled } = useAuth();` vira):

```tsx
  const { salesEnabled, accountRole } = useAuth();
```

E o filtro (dentro do `.map(({ label, group }) => { ... })`) muda de:

```tsx
        const items = SETTINGS_SECTIONS.filter((s) => {
          if (SECTION_META[s].group !== group) return false;
          const requiredModule = SECTION_MODULE[s];
          if (requiredModule === MODULES.SALES) return salesEnabled;
          return true;
        });
```

para:

```tsx
        const items = SETTINGS_SECTIONS.filter((s) => {
          if (SECTION_META[s].group !== group) return false;
          const requiredModule = SECTION_MODULE[s];
          if (requiredModule === MODULES.SALES && !salesEnabled) return false;
          return canAccessSection(s, accountRole);
        });
```

Note: isto preserva o comportamento anterior para o módulo de vendas (se
`salesEnabled` for falso, "Negócios" some, ponto final, papel nenhum
muda isso) e adiciona a checagem de papel para TODAS as seções, incluindo
"Negócios" quando o módulo está ligado — um `viewer` continua sem ver
"Negócios" mesmo com o módulo ligado, porque `canAccessSection('deals',
'viewer')` é falso.

- [ ] **Step 2: Modificar `src/app/(dashboard)/settings/page.tsx`**

Ler o arquivo atual primeiro. Duas mudanças:

**2a.** No import de `@/components/settings/settings-sections`, adicionar
`canAccessSection`:

```tsx
import {
  canAccessSection,
  resolveSection,
  type SettingsSection,
} from '@/components/settings/settings-sections';
```

**2b.** Em `SettingsPageInner`, a linha `const { defaultCurrency,
salesEnabled } = useAuth();` vira:

```tsx
  const { defaultCurrency, salesEnabled, accountRole, profileLoading } = useAuth();
```

E o bloco de resolução de seção muda de:

```tsx
  let section = resolveSection(searchParams.get('tab'));
  // Módulo de vendas desligado (Task 10): mesmo que alguém cole
  // `?tab=deals` direto na URL (o link já está escondido no rail e na
  // Overview), a seção não é a de Negócios e moeda — cai na Overview
  // como qualquer tab desconhecida.
  if (section === 'deals' && !salesEnabled) {
    section = 'overview';
  }
```

para:

```tsx
  let section = resolveSection(searchParams.get('tab'));
  // Módulo de vendas desligado (Task 10): mesmo que alguém cole
  // `?tab=deals` direto na URL (o link já está escondido no rail e na
  // Overview), a seção não é a de Negócios e moeda — cai na Overview
  // como qualquer tab desconhecida.
  if (section === 'deals' && !salesEnabled) {
    section = 'overview';
  }
  // Controle de acesso por papel (2026-09-09-settings-role-gating).
  // Espera `!profileLoading` antes de redirecionar: `accountRole` começa
  // null até o perfil carregar, e sem esperar um admin/owner entrando
  // direto em `?tab=whatsapp` (o link do menu da conta aponta pra lá)
  // seria jogado pra Visão geral por engano antes do papel resolver —
  // e como o redirect usa `router.replace` (em `go`, abaixo), a URL já
  // teria mudado e o usuário não voltaria sozinho pra aba certa.
  if (!profileLoading && !canAccessSection(section, accountRole)) {
    section = 'overview';
  }
```

- [ ] **Step 3: Rodar `tsc`**

Run: `npx tsc --noEmit`
Expected: sem erros.

- [ ] **Step 4: Rodar o lint**

Run: `npx eslint src/components/settings/settings-rail.tsx "src/app/(dashboard)/settings/page.tsx"`
Expected: sem erros.

- [ ] **Step 5: Rodar a suíte completa (regressão)**

Run: `npx vitest run`
Expected: mesma contagem de antes da Task 1 + os 4 testes novos da Task 1,
nenhuma falha nova (só as falhas pré-existentes de locale/timezone, se
houver — confirmar contra o resultado da Task 1 antes de julgar "nova
falha").

- [ ] **Step 6: Verificação manual (sem teste de componente — ver Global Constraints)**

Documentar no relatório da task que isto precisa ser confirmado
manualmente em homolog depois do deploy: logar como `agent` e como
`viewer` e conferir que o rail de Configurações e o `?tab=whatsapp`/
`?tab=groups` direto na URL se comportam como a spec descreve (seção 7,
critérios de aceitação). Não é um passo automatizável nesta task.

- [ ] **Step 7: Commit**

```bash
git add src/components/settings/settings-rail.tsx "src/app/(dashboard)/settings/page.tsx"
git commit -m "feat(settings): aplica canAccessSection no rail e no redirect"
```

---

### Task 3: `GET /api/whatsapp/config` exige admin

**Files:**
- Modify: `src/app/api/whatsapp/config/route.ts`
- Test: `src/app/api/whatsapp/config/route.test.ts`

**Interfaces:**
- Consumes: `canEditSettings`, `isAccountRole`, `type AccountRole` de
  `@/lib/auth/roles` (novo import neste arquivo).
- Produces: nada consumido por outras tasks — rota independente.

**Contexto:** o arquivo tem uma função `resolveAccountId` usada pelos
três handlers (GET, POST, DELETE), que só devolve `accountId: string |
null`. Ela vira `resolveCallerProfile`, devolvendo `{ accountId, role }`
— os três handlers precisam ajustar a desestruturação, mas só o GET
ganha a checagem nova (POST/DELETE já são protegidos pela RLS
`admins write channels`, e a spec não exige a checagem explícita neles).

- [ ] **Step 1: Escrever o teste que falha**

Criar `src/app/api/whatsapp/config/route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ createClient: vi.fn() }))

vi.mock('@/lib/supabase/server', () => ({
  createClient: mocks.createClient,
}))

import { GET } from './route'

function makeSupabase(profile: { account_id: string; account_role: string } | null) {
  return {
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: 'user-1' } }, error: null })),
    },
    from: (table: string) => {
      if (table === 'profiles') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: profile, error: null }),
            }),
          }),
        }
      }
      // whatsapp_channels — so alcancado se a checagem de papel deixar passar.
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: async () => ({ data: null, error: null }),
                }),
              }),
            }),
          }),
        }),
      }
    },
  }
}

describe('GET /api/whatsapp/config', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('recusa agent com 403, sem consultar whatsapp_channels', async () => {
    mocks.createClient.mockResolvedValue(
      makeSupabase({ account_id: 'acct-1', account_role: 'agent' }),
    )

    const res = await GET()
    const json = await res.json()

    expect(res.status).toBe(403)
    expect(json.error).toMatch(/admin/i)
  })

  it('recusa viewer com 403', async () => {
    mocks.createClient.mockResolvedValue(
      makeSupabase({ account_id: 'acct-1', account_role: 'viewer' }),
    )

    const res = await GET()

    expect(res.status).toBe(403)
  })

  it('deixa admin passar (chega na resposta de "sem config", nao no 403)', async () => {
    mocks.createClient.mockResolvedValue(
      makeSupabase({ account_id: 'acct-1', account_role: 'admin' }),
    )

    const res = await GET()
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.reason).toBe('no_config')
  })
})
```

- [ ] **Step 2: Rodar o teste, confirmar que falha**

Run: `npx vitest run src/app/api/whatsapp/config/route.test.ts`
Expected: FAIL nos dois primeiros testes (`res.status` é `200`, não
`403` — a rota hoje não recusa agent/viewer).

- [ ] **Step 3: Implementar**

Ler `src/app/api/whatsapp/config/route.ts` primeiro (509 linhas). Quatro
mudanças, todas nesse arquivo:

**3a.** Adicionar o import no topo:

```ts
import { canEditSettings, isAccountRole, type AccountRole } from '@/lib/auth/roles'
```

**3b.** Substituir a função `resolveAccountId` inteira:

```ts
/**
 * Resolve the caller's account_id + account_role from their profile.
 * Inlined here (rather than going through `@/lib/auth/account.getCurrentAccount`)
 * because the GET handler wants to return shaped 200s for every
 * non-auth failure mode, not throw — keeping the helper minimal lets
 * the existing response branches stay as-is.
 *
 * Returns null if the user has no profile or no account; callers
 * should treat that the same as "not connected".
 */
async function resolveCallerProfile(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<{ accountId: string; role: AccountRole | null } | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('account_id, account_role')
    .eq('user_id', userId)
    .maybeSingle()
  if (error || !data?.account_id) return null
  return {
    accountId: data.account_id as string,
    role: isAccountRole(data.account_role) ? data.account_role : null,
  }
}
```

**3c.** No handler `GET`, substituir:

```ts
    const accountId = await resolveAccountId(supabase, user.id)
    if (!accountId) {
      return NextResponse.json(
        {
          connected: false,
          reason: 'no_account',
          message: 'Your profile is not linked to an account.',
        },
        { status: 200 },
      )
    }
```

por:

```ts
    const profile = await resolveCallerProfile(supabase, user.id)
    if (!profile) {
      return NextResponse.json(
        {
          connected: false,
          reason: 'no_account',
          message: 'Your profile is not linked to an account.',
        },
        { status: 200 },
      )
    }

    if (!profile.role || !canEditSettings(profile.role)) {
      return NextResponse.json(
        { error: 'Only account admins can view the WhatsApp configuration.' },
        { status: 403 },
      )
    }

    const accountId = profile.accountId
```

O resto do handler `GET` (a query em `whatsapp_channels` e tudo depois)
continua igual — só passa a usar a variável `accountId` já resolvida
acima, sem mudança de nome no resto do corpo.

**3d.** No handler `POST`, substituir apenas:

```ts
    const accountId = await resolveAccountId(supabase, user.id)
    if (!accountId) {
      return NextResponse.json(
        { error: 'Your profile is not linked to an account.' },
        { status: 403 },
      )
    }
```

por:

```ts
    const profile = await resolveCallerProfile(supabase, user.id)
    if (!profile) {
      return NextResponse.json(
        { error: 'Your profile is not linked to an account.' },
        { status: 403 },
      )
    }
    const accountId = profile.accountId
```

Sem checagem de papel nova aqui — a RLS `admins write channels` já
bloqueia a escrita, e a spec (seção 6) não exige a checagem explícita
neste handler.

**3e.** No handler `DELETE`, a mesma substituição do 3d (mesmíssimas
linhas, mesmo texto de erro).

- [ ] **Step 4: Rodar o teste, confirmar que passa**

Run: `npx vitest run src/app/api/whatsapp/config/route.test.ts`
Expected: PASS — 3 testes.

- [ ] **Step 5: `tsc` + lint + suíte completa**

Run: `npx tsc --noEmit`
Expected: sem erros (conferir que não sobrou nenhuma referência a
`resolveAccountId` no arquivo — o nome mudou para `resolveCallerProfile`
nos três handlers).

Run: `npx eslint src/app/api/whatsapp/config/route.ts src/app/api/whatsapp/config/route.test.ts`
Expected: sem erros.

Run: `npx vitest run`
Expected: sem falhas novas.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/whatsapp/config/route.ts src/app/api/whatsapp/config/route.test.ts
git commit -m "fix(settings): GET /api/whatsapp/config exige admin"
```

---

### Task 4: `GET /api/whatsapp/config/verify-registration` exige admin

**Files:**
- Modify: `src/app/api/whatsapp/config/verify-registration/route.ts`
- Test: `src/app/api/whatsapp/config/verify-registration/route.test.ts`

**Interfaces:**
- Consumes: `canEditSettings`, `isAccountRole` de `@/lib/auth/roles`
  (novo import).
- Produces: nada consumido por outras tasks.

**Contexto:** este arquivo resolve o perfil inline (não tem uma função
helper separada, ao contrário de `config/route.ts`). A mudança é
localizada: estender o `.select()` pra trazer `account_role` também, e
inserir a checagem logo depois de confirmar que `accountId` existe.

- [ ] **Step 1: Escrever o teste que falha**

Criar `src/app/api/whatsapp/config/verify-registration/route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ createClient: vi.fn() }))

vi.mock('@/lib/supabase/server', () => ({
  createClient: mocks.createClient,
}))

import { GET } from './route'

function makeSupabase(profile: { account_id: string; account_role: string } | null) {
  return {
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: 'user-1' } }, error: null })),
    },
    from: (table: string) => {
      if (table === 'profiles') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: profile, error: null }),
            }),
          }),
        }
      }
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: async () => ({ data: null, error: null }),
                }),
              }),
            }),
          }),
        }),
      }
    },
  }
}

describe('GET /api/whatsapp/config/verify-registration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('recusa agent com 403', async () => {
    mocks.createClient.mockResolvedValue(
      makeSupabase({ account_id: 'acct-1', account_role: 'agent' }),
    )

    const res = await GET()

    expect(res.status).toBe(403)
  })

  it('recusa viewer com 403', async () => {
    mocks.createClient.mockResolvedValue(
      makeSupabase({ account_id: 'acct-1', account_role: 'viewer' }),
    )

    const res = await GET()

    expect(res.status).toBe(403)
  })

  it('deixa admin passar (chega na resposta de "sem config")', async () => {
    mocks.createClient.mockResolvedValue(
      makeSupabase({ account_id: 'acct-1', account_role: 'admin' }),
    )

    const res = await GET()
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.checks.config_exists).toBe(false)
  })
})
```

- [ ] **Step 2: Rodar o teste, confirmar que falha**

Run: `npx vitest run src/app/api/whatsapp/config/verify-registration/route.test.ts`
Expected: FAIL nos dois primeiros (a rota hoje devolve 200 pra
agent/viewer também).

- [ ] **Step 3: Implementar**

Ler `src/app/api/whatsapp/config/verify-registration/route.ts` primeiro
(163 linhas). Duas mudanças:

**3a.** Adicionar o import no topo:

```ts
import { canEditSettings, isAccountRole } from '@/lib/auth/roles'
```

**3b.** Substituir:

```ts
  const { data: profile } = await supabase
    .from('profiles')
    .select('account_id')
    .eq('user_id', user.id)
    .maybeSingle()
  const accountId = profile?.account_id as string | undefined
  if (!accountId) {
    return NextResponse.json({
      live: false,
      checks: { config_exists: false },
      message: 'Your profile is not linked to an account.',
    })
  }
```

por:

```ts
  const { data: profile } = await supabase
    .from('profiles')
    .select('account_id, account_role')
    .eq('user_id', user.id)
    .maybeSingle()
  const accountId = profile?.account_id as string | undefined
  if (!accountId) {
    return NextResponse.json({
      live: false,
      checks: { config_exists: false },
      message: 'Your profile is not linked to an account.',
    })
  }

  const role = isAccountRole(profile?.account_role) ? profile.account_role : null
  if (!role || !canEditSettings(role)) {
    return NextResponse.json(
      { error: 'Only account admins can view WhatsApp registration diagnostics.' },
      { status: 403 },
    )
  }
```

- [ ] **Step 4: Rodar o teste, confirmar que passa**

Run: `npx vitest run src/app/api/whatsapp/config/verify-registration/route.test.ts`
Expected: PASS — 3 testes.

- [ ] **Step 5: `tsc` + lint + suíte completa**

Run: `npx tsc --noEmit` — sem erros.
Run: `npx eslint src/app/api/whatsapp/config/verify-registration/route.ts src/app/api/whatsapp/config/verify-registration/route.test.ts` — sem erros.
Run: `npx vitest run` — sem falhas novas.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/whatsapp/config/verify-registration/route.ts src/app/api/whatsapp/config/verify-registration/route.test.ts
git commit -m "fix(settings): GET .../verify-registration exige admin"
```

---

### Task 5: `GET /api/whatsapp/channels/[id]/status` troca `getCurrentAccount` por `requireRole("admin")`

**Files:**
- Modify: `src/app/api/whatsapp/channels/[id]/status/route.ts`
- Test: `src/app/api/whatsapp/channels/[id]/status/route.test.ts`

**Interfaces:**
- Consumes: `requireRole` de `@/lib/auth/account` (já existe no
  projeto, usado hoje por `channels/[id]/webhook-url/route.ts` — só
  troca de `getCurrentAccount` pra `requireRole("admin")` neste arquivo).
- Produces: nada consumido por outras tasks.

**Contexto:** este arquivo já usa `getCurrentAccount()` (sem checagem de
papel) do mesmo módulo `@/lib/auth/account`. `requireRole("admin")`
devolve exatamente o mesmo formato (`{ supabase, accountId, ... }`), só
que já lança `ForbiddenError` (403, mapeado por `toErrorResponse` que
este arquivo já usa) quando o papel não alcança admin — é uma troca de
uma linha de import e uma linha de uso, nada mais no arquivo muda.

- [ ] **Step 1: Escrever o teste que falha**

Criar `src/app/api/whatsapp/channels/[id]/status/route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ForbiddenError } from '@/lib/auth/account'

const mocks = vi.hoisted(() => ({
  requireRole: vi.fn(),
  decrypt: vi.fn(),
  uazapiGet: vi.fn(),
  registerUazapiWebhook: vi.fn(),
}))

vi.mock('@/lib/auth/account', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/account')>()
  return { ...actual, requireRole: mocks.requireRole }
})

vi.mock('@/lib/whatsapp/encryption', () => ({
  decrypt: mocks.decrypt,
}))

vi.mock('@/lib/whatsapp/uazapi/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/whatsapp/uazapi/client')>()
  return {
    ...actual,
    createUazapiClient: () => ({ get: mocks.uazapiGet, post: vi.fn() }),
  }
})

vi.mock('@/lib/whatsapp/uazapi/register-webhook', () => ({
  registerUazapiWebhook: mocks.registerUazapiWebhook,
}))

import { GET } from './route'

function request() {
  return new Request('http://localhost/api/whatsapp/channels/chan-1/status')
}

describe('GET /api/whatsapp/channels/[id]/status', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.decrypt.mockReturnValue('token-plano')
    mocks.uazapiGet.mockResolvedValue({ instance: { status: 'connecting' }, status: {} })
  })

  it('exige o papel admin — nao so pertencer a conta', async () => {
    mocks.requireRole.mockRejectedValue(
      new ForbiddenError("This action requires the 'admin' role or higher"),
    )

    const res = await GET(request(), { params: Promise.resolve({ id: 'chan-1' }) })

    expect(res.status).toBe(403)
    expect(mocks.requireRole).toHaveBeenCalledWith('admin')
  })

  it('deixa admin passar do gate (nao e barrado, chega no proxy da uazapi)', async () => {
    mocks.requireRole.mockResolvedValue({
      supabase: {
        from: () => ({
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    id: 'chan-1',
                    uazapi_base_url: 'https://x.uazapi.com',
                    uazapi_token: 'ciphertext',
                    status: 'connecting',
                    webhook_registered_at: '2026-01-01T00:00:00Z',
                  },
                  error: null,
                }),
              }),
            }),
          }),
          update: () => ({ eq: async () => ({ error: null }) }),
        }),
      },
      accountId: 'acct-1',
    })

    const res = await GET(request(), { params: Promise.resolve({ id: 'chan-1' }) })

    expect(res.status).not.toBe(403)
    expect(mocks.requireRole).toHaveBeenCalledWith('admin')
  })
})
```

- [ ] **Step 2: Rodar o teste, confirmar que falha**

Run: `npx vitest run "src/app/api/whatsapp/channels/[id]/status/route.test.ts"`
Expected: FAIL no primeiro teste — `mocks.requireRole` nunca é chamado
porque a rota hoje chama `getCurrentAccount()`, e como esse mock não
está configurado (só `requireRole` foi mockado), `getCurrentAccount`
real seria chamado e provavelmente lançaria por falta de sessão real —
de qualquer forma, `expect(mocks.requireRole).toHaveBeenCalledWith('admin')`
falha porque a função nunca foi chamada.

- [ ] **Step 3: Implementar**

Ler `src/app/api/whatsapp/channels/[id]/status/route.ts` primeiro (82
linhas). Duas linhas mudam:

De:

```ts
import { getCurrentAccount, toErrorResponse } from "@/lib/auth/account";
```

para:

```ts
import { requireRole, toErrorResponse } from "@/lib/auth/account";
```

E de:

```ts
    const { supabase, accountId } = await getCurrentAccount();
```

para:

```ts
    const { supabase, accountId } = await requireRole("admin");
```

Nada mais no arquivo muda — o resto do handler já usa só `supabase` e
`accountId`, que `requireRole` devolve no mesmo formato.

- [ ] **Step 4: Rodar o teste, confirmar que passa**

Run: `npx vitest run "src/app/api/whatsapp/channels/[id]/status/route.test.ts"`
Expected: PASS — 2 testes.

- [ ] **Step 5: `tsc` + lint + suíte completa**

Run: `npx tsc --noEmit` — sem erros.
Run: `npx eslint "src/app/api/whatsapp/channels/[id]/status/route.ts" "src/app/api/whatsapp/channels/[id]/status/route.test.ts"` — sem erros.
Run: `npx vitest run` — sem falhas novas.

- [ ] **Step 6: Commit**

```bash
git add "src/app/api/whatsapp/channels/[id]/status/route.ts" "src/app/api/whatsapp/channels/[id]/status/route.test.ts"
git commit -m "fix(settings): GET .../channels/[id]/status exige admin"
```

---

### Task 6: `GET /api/whatsapp/groups` exige admin

**Files:**
- Modify: `src/app/api/whatsapp/groups/route.ts`
- Test: `src/app/api/whatsapp/groups/route.test.ts`

**Interfaces:**
- Consumes: `canEditSettings` de `@/lib/auth/roles` (já importado neste
  arquivo, usado hoje só pelo `PATCH`).
- Produces: nada consumido por outras tasks.

**Contexto:** este arquivo já tem `resolveCallerProfile` devolvendo
`{ accountId, role }`, e o `PATCH` já faz exatamente a checagem que o
`GET` precisa. É a MESMA checagem, só que no handler `GET`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `src/app/api/whatsapp/groups/route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ createClient: vi.fn() }))

vi.mock('@/lib/supabase/server', () => ({
  createClient: mocks.createClient,
}))

import { GET } from './route'

function makeSupabase(profile: { account_id: string; account_role: string } | null) {
  return {
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: 'user-1' } }, error: null })),
    },
    from: (table: string) => {
      if (table === 'profiles') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: profile, error: null }),
            }),
          }),
        }
      }
      // whatsapp_groups — so alcancado se a checagem de papel deixar passar.
      return {
        select: () => ({
          eq: () => ({
            order: async () => ({ data: [], error: null }),
          }),
        }),
      }
    },
  }
}

describe('GET /api/whatsapp/groups', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('recusa agent com 403', async () => {
    mocks.createClient.mockResolvedValue(
      makeSupabase({ account_id: 'acct-1', account_role: 'agent' }),
    )

    const res = await GET(new Request('http://localhost/api/whatsapp/groups'))
    const json = await res.json()

    expect(res.status).toBe(403)
    expect(json.error).toMatch(/admin/i)
  })

  it('recusa viewer com 403', async () => {
    mocks.createClient.mockResolvedValue(
      makeSupabase({ account_id: 'acct-1', account_role: 'viewer' }),
    )

    const res = await GET(new Request('http://localhost/api/whatsapp/groups'))

    expect(res.status).toBe(403)
  })

  it('deixa admin passar e devolver a lista', async () => {
    mocks.createClient.mockResolvedValue(
      makeSupabase({ account_id: 'acct-1', account_role: 'admin' }),
    )

    const res = await GET(new Request('http://localhost/api/whatsapp/groups'))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.groups).toEqual([])
  })
})
```

- [ ] **Step 2: Rodar o teste, confirmar que falha**

Run: `npx vitest run src/app/api/whatsapp/groups/route.test.ts`
Expected: FAIL nos dois primeiros (a rota hoje devolve 200 pra
agent/viewer).

- [ ] **Step 3: Implementar**

Ler `src/app/api/whatsapp/groups/route.ts` primeiro (178 linhas). No
handler `GET`, logo depois do bloco:

```ts
    const profile = await resolveCallerProfile(supabase, user.id);
    if (!profile) {
      return NextResponse.json(
        { error: "Your profile is not linked to an account." },
        { status: 403 },
      );
    }
```

inserir:

```ts

    if (!profile.role || !canEditSettings(profile.role)) {
      return NextResponse.json(
        { error: "Only account admins can view groups." },
        { status: 403 },
      );
    }
```

(antes da query `.from("whatsapp_groups").select(...)` que vem em
seguida). `canEditSettings` já está importado no topo do arquivo — não
precisa de import novo.

- [ ] **Step 4: Rodar o teste, confirmar que passa**

Run: `npx vitest run src/app/api/whatsapp/groups/route.test.ts`
Expected: PASS — 3 testes.

- [ ] **Step 5: `tsc` + lint + suíte completa**

Run: `npx tsc --noEmit` — sem erros.
Run: `npx eslint src/app/api/whatsapp/groups/route.ts src/app/api/whatsapp/groups/route.test.ts` — sem erros.
Run: `npx vitest run` — sem falhas novas (conferir também que os testes
já existentes de `PATCH /api/whatsapp/groups`, se houver algum em outro
arquivo, continuam passando).

- [ ] **Step 6: Commit**

```bash
git add src/app/api/whatsapp/groups/route.ts src/app/api/whatsapp/groups/route.test.ts
git commit -m "fix(settings): GET /api/whatsapp/groups exige admin"
```

---

### Task 7: `GET /api/whatsapp/groups/[id]/participants` exige admin

**Files:**
- Modify: `src/app/api/whatsapp/groups/[id]/participants/route.ts`
- Test: `src/app/api/whatsapp/groups/[id]/participants/route.test.ts`

**Interfaces:**
- Consumes: `canEditSettings` de `@/lib/auth/roles` (já importado neste
  arquivo, usado hoje só pelo `POST`).
- Produces: nada consumido por outras tasks — última task do plano.

**Contexto:** mesmo padrão da Task 6. O `POST` deste MESMO arquivo já
tem a checagem certa; o `GET` hoje tem um comentário explícito dizendo
"não exige admin para ler" — isso deixa de ser verdade e o comentário
precisa mudar junto.

- [ ] **Step 1: Escrever o teste que falha**

Criar `src/app/api/whatsapp/groups/[id]/participants/route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ createClient: vi.fn() }))

vi.mock('@/lib/supabase/server', () => ({
  createClient: mocks.createClient,
}))

vi.mock('@/lib/whatsapp/providers/resolve', () => ({
  getProviderForChannel: vi.fn(),
}))

import { GET } from './route'

function makeSupabase(profile: { account_id: string; account_role: string } | null) {
  return {
    auth: {
      getUser: vi.fn(async () => ({ data: { user: { id: 'user-1' } }, error: null })),
    },
    from: (table: string) => {
      if (table === 'profiles') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: profile, error: null }),
            }),
          }),
        }
      }
      // whatsapp_groups (loadGroup) — so alcancado se a checagem de papel deixar passar.
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
        }),
      }
    },
  }
}

function callRoute(id = 'grp-1') {
  return GET(new Request(`http://localhost/api/whatsapp/groups/${id}/participants`), {
    params: Promise.resolve({ id }),
  })
}

describe('GET /api/whatsapp/groups/[id]/participants', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('recusa agent com 403, sem carregar o grupo', async () => {
    mocks.createClient.mockResolvedValue(
      makeSupabase({ account_id: 'acct-1', account_role: 'agent' }),
    )

    const res = await callRoute()
    const json = await res.json()

    expect(res.status).toBe(403)
    expect(json.error).toMatch(/admin/i)
  })

  it('recusa viewer com 403', async () => {
    mocks.createClient.mockResolvedValue(
      makeSupabase({ account_id: 'acct-1', account_role: 'viewer' }),
    )

    const res = await callRoute()

    expect(res.status).toBe(403)
  })

  it('deixa admin passar do gate (404 de "grupo nao encontrado", nao 403)', async () => {
    mocks.createClient.mockResolvedValue(
      makeSupabase({ account_id: 'acct-1', account_role: 'admin' }),
    )

    const res = await callRoute()

    expect(res.status).toBe(404)
  })
})
```

- [ ] **Step 2: Rodar o teste, confirmar que falha**

Run: `npx vitest run "src/app/api/whatsapp/groups/[id]/participants/route.test.ts"`
Expected: FAIL nos dois primeiros (a rota hoje devolve 404 — "não
encontrado" — pra agent/viewer também, já que ela nunca checa papel e
cai direto na busca do grupo).

- [ ] **Step 3: Implementar**

Ler `src/app/api/whatsapp/groups/[id]/participants/route.ts` primeiro
(183 linhas). Duas mudanças:

**3a.** Atualizar o comentário de topo do arquivo — a linha "GET: lista
ao vivo... Não exige admin para ler." não é mais verdade:

De:

```ts
// GET: lista ao vivo (nunca cache local) + se o número conectado é
// admin. Não exige admin para ler.
//
// POST: add/remove/promote/demote, um telefone por vez. Exige admin.
```

para:

```ts
// GET: lista ao vivo (nunca cache local) + se o número conectado é
// admin. Exige admin da CONTA no CRM para ler (2026-09-09-settings-
// role-gating) — antes desta mudança qualquer membro da conta podia
// ver a lista de participantes de um grupo.
//
// POST: add/remove/promote/demote, um telefone por vez. Exige admin.
```

**3b.** No handler `GET`, logo depois do bloco:

```ts
    const profile = await resolveCallerProfile(supabase, user.id);
    if (!profile) {
      return NextResponse.json(
        { error: "Your profile is not linked to an account." },
        { status: 403 },
      );
    }
```

inserir:

```ts

    if (!profile.role || !canEditSettings(profile.role)) {
      return NextResponse.json(
        { error: "Only account admins can view group participants." },
        { status: 403 },
      );
    }
```

(antes de `const group = await loadGroup(supabase, id, profile.accountId);`).
`canEditSettings` já está importado no topo do arquivo.

- [ ] **Step 4: Rodar o teste, confirmar que passa**

Run: `npx vitest run "src/app/api/whatsapp/groups/[id]/participants/route.test.ts"`
Expected: PASS — 3 testes.

- [ ] **Step 5: `tsc` + lint + suíte completa**

Run: `npx tsc --noEmit` — sem erros.
Run: `npx eslint "src/app/api/whatsapp/groups/[id]/participants/route.ts" "src/app/api/whatsapp/groups/[id]/participants/route.test.ts"` — sem erros.
Run: `npx vitest run` — sem falhas novas.

- [ ] **Step 6: Commit**

```bash
git add "src/app/api/whatsapp/groups/[id]/participants/route.ts" "src/app/api/whatsapp/groups/[id]/participants/route.test.ts"
git commit -m "fix(settings): GET .../groups/[id]/participants exige admin"
```

---

## Depois da última task

Todas as 7 tasks completas cobrem a spec inteira (seções 4, 5 e 6). Segue
o fluxo normal de SDD: revisão final de toda a branch, e então
`superpowers:finishing-a-development-branch` para decidir o destino —
mas como esta feature não é sobre grupos de WhatsApp especificamente
(mexe em Modelos, Membros, Chaves de API, Negócios também), vale
perguntar ao usuário se o destino deve ser o mesmo branch
`feat/grupos-whatsapp-fase3` ou um branch/PR separado antes de decidir.

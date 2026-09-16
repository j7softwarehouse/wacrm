# Grupos de WhatsApp — Fase 2 (envio) — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que o operador envie texto e mídia numa conversa de grupo pelo CRM, com a assinatura do atendente, sem afetar o envio 1:1 nem afrouxar a trava que impede motores automáticos de responderem em grupo.

**Architecture:** `sendMessageToConversation` passa a resolver o destino por dois caminhos — `whatsapp_groups.group_jid` quando a conversa tem `group_id`, `contact.phone` caso contrário. A retentativa de variantes de telefone e a auto-correção de contato ficam isoladas no caminho 1:1. O provider não muda: a uazapi já aceita o JID de grupo no mesmo campo `number` (verificado empiricamente contra a instância real). Na UI, o composer deixa de ser bloqueado em grupo.

**Tech Stack:** Next.js (App Router), TypeScript, Supabase (Postgres + RLS), Vitest, uazapi.

**Spec:** `docs/superpowers/specs/2026-09-03-grupos-whatsapp-fase2-design.md`

## Global Constraints

- **Não tocar em `shouldDispatchEngines`** (`src/lib/whatsapp/inbound/ingest.ts`). Ela protege mensagens RECEBIDAS contra motores automáticos; enviar pelo composer é ação humana e não passa por lá. Nenhuma tarefa deste plano tem motivo para alterá-la.
- **Nenhum registro em `contacts`** pode ser criado ou alterado ao enviar em grupo.
- **Envio 1:1 não pode regredir** — suíte completa antes de cada commit.
- **Não há migration nesta fase.** O schema da Fase 1 já basta; nenhuma tarefa deve criar arquivo em `supabase/migrations/`.
- **Verificação de `tsc`:** colar a saída REAL de `npx tsc --noEmit` no relatório, nunca parafrasear.
- **Falhas pré-existentes conhecidas na suíte:** 5, em `src/lib/currency.test.ts` (3) e `src/lib/dashboard/date-utils.test.ts` (2), por locale/timezone da máquina. Qualquer falha ALÉM dessas é regressão a investigar.
- **Comentários e mensagens de commit em português**, seguindo o padrão do repositório.

---

## File Structure

**Modificados:**
- `src/lib/whatsapp/send-message.ts` — resolução do destino em dois caminhos; isolamento da retentativa de telefone.
- `src/lib/whatsapp/send-message.test.ts` — testes do caminho de grupo.
- `src/components/inbox/message-thread.tsx` — para de bloquear o composer em grupo.
- `src/components/inbox/message-composer.tsx` — esconde o construtor de interativo em grupo; remove a prop `groupReadOnly` órfã.

**Nenhum arquivo criado.** Nenhuma migration.

**Ordem:** backend (Tarefas 1-2) → UI (Tarefa 3) → verificação real (Tarefa 4). O envio precisa funcionar antes de a UI oferecê-lo.

---

### Task 1: Resolver o destino de grupo em `sendMessageToConversation`

**Files:**
- Modify: `src/lib/whatsapp/send-message.ts`
- Test: `src/lib/whatsapp/send-message.test.ts`

**Interfaces:**
- Consumes: `whatsapp_groups.group_jid` (schema da Fase 1), `conversations.group_id`.
- Produces: `sendMessageToConversation` aceitando conversa de grupo. Nenhuma assinatura pública muda.

- [ ] **Step 1: Escrever o teste que falha**

Acrescentar em `send-message.test.ts` um novo `describe`. O fake de `db` precisa devolver uma conversa de grupo (com `contact: null`, `group_id` preenchido e `group` embutido), no mesmo estilo dos fakes já usados no arquivo:

```typescript
describe('sendMessageToConversation — conversa de grupo', () => {
  beforeEach(() => {
    mocks.getProviderForConversation.mockResolvedValue({
      sendText: async () => ({ messageId: 'wamid-grupo-1' }),
    });
  });

  /** Conversa de grupo: sem contato, com `group` embutido pela query. */
  function groupDb(capture: { rows: Record<string, unknown>[]; tables: string[] }) {
    return {
      from: (table: string) => {
        capture.tables.push(table);
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                single: async () => ({
                  data: {
                    id: 'cv-grupo',
                    account_id: 'acct-1',
                    contact_id: null,
                    group_id: 'grp-1',
                    contact: null,
                    group: { id: 'grp-1', group_jid: '120363000000000000@g.us' },
                  },
                  error: null,
                }),
                maybeSingle: async () => ({ data: null, error: null }),
              }),
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
          insert: (row: Record<string, unknown>) => {
            capture.rows.push(row);
            return {
              select: () => ({
                single: async () => ({ data: { id: 'msg-grupo-1', ...row }, error: null }),
              }),
            };
          },
          update: () => ({ eq: async () => ({ error: null }) }),
        };
      },
    } as unknown as SupabaseClient;
  }

  it('envia texto para o JID do grupo em vez de telefone', async () => {
    const sendText = vi.fn(async () => ({ messageId: 'wamid-grupo-1' }));
    mocks.getProviderForConversation.mockResolvedValue({ sendText });
    const capture = { rows: [] as Record<string, unknown>[], tables: [] as string[] };

    const result = await sendMessageToConversation(groupDb(capture), 'acct-1', {
      conversationId: 'cv-grupo',
      messageType: 'text',
      contentText: 'oi grupo',
      senderUserId: 'user-1',
    });

    expect(sendText).toHaveBeenCalledWith(
      expect.objectContaining({ to: '120363000000000000@g.us' }),
    );
    expect(result.messageId).toBe('msg-grupo-1');
  });

  it('NAO toca na tabela contacts ao enviar em grupo', async () => {
    // Requisito duro da Fase 1 que a Fase 2 nao pode quebrar: a
    // auto-correcao de telefone do caminho 1:1 grava em `contacts`, e
    // conversa de grupo nao tem contato nenhum para corrigir.
    const capture = { rows: [] as Record<string, unknown>[], tables: [] as string[] };

    await sendMessageToConversation(groupDb(capture), 'acct-1', {
      conversationId: 'cv-grupo',
      messageType: 'text',
      contentText: 'oi',
      senderUserId: 'user-1',
    });

    expect(capture.tables).not.toContain('contacts');
  });

  it('grava a mensagem enviada com sender_id do operador e sem participant_id', async () => {
    const capture = { rows: [] as Record<string, unknown>[], tables: [] as string[] };

    await sendMessageToConversation(groupDb(capture), 'acct-1', {
      conversationId: 'cv-grupo',
      messageType: 'text',
      contentText: 'oi',
      senderUserId: 'user-1',
    });

    const message = capture.rows.find((r) => r.sender_type === 'agent');
    expect(message).toMatchObject({
      conversation_id: 'cv-grupo',
      sender_type: 'agent',
      sender_id: 'user-1',
    });
    // participant_id identifica quem escreveu numa mensagem RECEBIDA;
    // mensagem enviada e do nosso time, o autor vem de sender_id.
    expect(message?.participant_id).toBeUndefined();
  });

  it('recusa conversa de grupo cujo grupo nao foi encontrado', async () => {
    const db = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              single: async () => ({
                data: {
                  id: 'cv-grupo',
                  account_id: 'acct-1',
                  contact_id: null,
                  group_id: 'grp-sumiu',
                  contact: null,
                  group: null,
                },
                error: null,
              }),
            }),
          }),
        }),
      }),
    } as unknown as SupabaseClient;

    await expect(
      sendMessageToConversation(db, 'acct-1', {
        conversationId: 'cv-grupo',
        messageType: 'text',
        contentText: 'oi',
        senderUserId: 'user-1',
      }),
    ).rejects.toBeInstanceOf(SendMessageError);
  });
});
```

- [ ] **Step 2: Rodar e confirmar que falha pelo motivo certo**

Run: `npx vitest run src/lib/whatsapp/send-message.test.ts`
Esperado: FAIL. O motivo deve ser o guard atual `if (!contact?.phone) throw` — conversa de grupo não tem contato. Se falhar por outro motivo (ex: erro no fake), conserte o fake antes de seguir: o teste precisa falhar pela ausência do suporte a grupo, não por defeito do próprio teste.

- [ ] **Step 3: Embutir o grupo na query da conversa**

Em `sendMessageToConversation`, trocar o `.select` (por volta da linha 224):

```typescript
  const { data: conversation, error: convError } = await db
    .from('conversations')
    .select('*, contact:contacts(*), group:whatsapp_groups(id, group_jid)')
    .eq('id', conversationId)
    .eq('account_id', accountId)
    .single();
```

- [ ] **Step 4: Resolver o destino em dois caminhos**

Substituir o bloco que hoje exige contato e valida E.164 (linhas ~234-251) por:

```typescript
  // Conversa de grupo resolve o destino pelo JID; 1:1 pelo telefone do
  // contato. `conversations_contact_xor_group` garante que exatamente um
  // dos dois existe, então os dois ramos são mutuamente exclusivos.
  const group = conversation.group as { group_jid?: string } | null;
  const isGroupConversation = Boolean(conversation.group_id);

  let destination: string;
  const contact = conversation.contact;

  if (isGroupConversation) {
    if (!group?.group_jid) {
      throw new SendMessageError(
        'bad_request',
        'Group not found for this conversation',
        400,
      );
    }
    // O JID vai como está: a uazapi aceita com ou sem o sufixo `@g.us`
    // (verificado contra a instância real) e normaliza sozinha. Nada de
    // `sanitizePhoneForMeta`/`isValidE164` aqui — o JID tem 18+ dígitos
    // e seria recusado por uma validação feita para telefone.
    destination = group.group_jid;
  } else {
    if (!contact?.phone) {
      throw new SendMessageError(
        'bad_request',
        'Contact phone number not found',
        400,
      );
    }
    const sanitizedPhone = sanitizePhoneForMeta(contact.phone);
    if (!isValidE164(sanitizedPhone)) {
      throw new SendMessageError(
        'bad_request',
        'Invalid phone number format',
        400,
      );
    }
    destination = sanitizedPhone;
  }
```

- [ ] **Step 5: Isolar a retentativa de variantes no caminho 1:1**

O bloco de envio (linhas ~395-436) hoje sempre percorre `phoneVariants` e depois grava o número que funcionou em `contacts`. Reestruturar para que grupo faça uma tentativa única e nunca toque em `contacts`:

```typescript
  let waMessageId = '';

  if (isGroupConversation) {
    // Tentativa única: `phoneVariants` existe para o trunk prefix de
    // telefone no sandbox da Meta, que não se aplica a um JID de grupo.
    try {
      waMessageId = await attempt(destination);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unknown provider error';
      console.error('[send-message] envio em grupo falhou:', message);
      throw new SendMessageError('meta_error', `Meta API error: ${message}`, 502);
    }
  } else {
    // Caminho 1:1 — lógica idêntica à de hoje, apenas indentada para
    // dentro deste `else` e usando `destination` no lugar de
    // `sanitizedPhone` (que passou a ser local do ramo 1:1 no Step 4).
    let workingPhone = destination;
    try {
      const variants = phoneVariants(destination);
      let lastError: unknown = null;

      for (const variant of variants) {
        try {
          waMessageId = await attempt(variant);
          workingPhone = variant;
          lastError = null;
          break;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          if (!isRecipientNotAllowedError(message)) {
            throw err;
          }
          lastError = err;
          console.warn(
            `[send-message] variant "${variant}" rejected by Meta, trying next…`,
          );
        }
      }

      if (lastError) throw lastError;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unknown Meta API error';
      console.error('[send-message] Meta send failed for all variants:', message);
      throw new SendMessageError('meta_error', `Meta API error: ${message}`, 502);
    }

    if (workingPhone !== destination) {
      console.log(
        `[send-message] Auto-corrected contact phone: ${destination} → ${workingPhone}`,
      );
      await db
        .from('contacts')
        .update({ phone: workingPhone })
        .eq('id', contact!.id);
    }
  }
```

⚠️ `contact!.id` na auto-correção: dentro deste `else`, `contact` já foi
validado como não-nulo no Step 4 (o `throw` de "Contact phone number not
found"), mas o TypeScript não estreita o tipo através daquela distância.
Se preferir evitar o `!`, guarde o contato validado numa const local no
Step 4 e use-a aqui — o importante é não silenciar o compilador com
`any`.

⚠️ Não alterar a lógica interna do bloco 1:1 — só envolvê-la. A auto-correção referencia `contact.id`; deixá-la fora do `else` quebraria em runtime com `contact` nulo, que é exatamente o que o teste "NAO toca na tabela contacts" pega.

- [ ] **Step 6: Rodar os testes novos e confirmar que passam**

Run: `npx vitest run src/lib/whatsapp/send-message.test.ts`
Esperado: PASS, incluindo os testes 1:1 que já existiam no arquivo.

- [ ] **Step 7: Rodar a suíte completa**

Run: `npx vitest run`
Esperado: só as 5 falhas pré-existentes de locale.

Run: `npx tsc --noEmit` — colar a saída real no relatório.

- [ ] **Step 8: Commit**

```bash
git add src/lib/whatsapp/send-message.ts src/lib/whatsapp/send-message.test.ts
git commit -m "feat(grupos): envia mensagem para o JID do grupo"
```

---

### Task 2: Assinatura do atendente em mensagem de grupo

**Files:**
- Test: `src/lib/whatsapp/send-message.test.ts`
- Modify: `src/lib/whatsapp/send-message.ts` (só se o teste revelar necessidade)

**Interfaces:**
- Consumes: `withAgentSignature` (`src/lib/whatsapp/outbound-signature.ts`), já existente.

Esta tarefa provavelmente **não precisa de mudança de produção**: a assinatura é aplicada antes do envio, com base em `senderUserId`, sem olhar se é grupo ou 1:1. A tarefa existe para PROVAR isso com teste — se passar de primeira, é caracterização, e o relatório deve dizer isso explicitamente em vez de fingir um ciclo RED→GREEN.

- [ ] **Step 1: Escrever o teste**

Acrescentar ao `describe` de grupo criado na Tarefa 1. O fake precisa devolver o perfil do operador quando `sendMessageToConversation` consultar `profiles`:

```typescript
  it('assina a mensagem de grupo com o nome do atendente', async () => {
    // Em grupo a assinatura importa mais que no 1:1: varias pessoas leem,
    // e sem ela ninguem sabe qual atendente respondeu.
    const sendText = vi.fn(async () => ({ messageId: 'wamid-grupo-1' }));
    mocks.getProviderForConversation.mockResolvedValue({ sendText });

    const db = {
      from: (table: string) => {
        if (table === 'profiles') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { full_name: 'Ramon Paula' },
                  error: null,
                }),
              }),
            }),
          };
        }
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                single: async () => ({
                  data: {
                    id: 'cv-grupo',
                    account_id: 'acct-1',
                    contact_id: null,
                    group_id: 'grp-1',
                    contact: null,
                    group: { id: 'grp-1', group_jid: '120363000000000000@g.us' },
                  },
                  error: null,
                }),
                maybeSingle: async () => ({ data: null, error: null }),
              }),
              maybeSingle: async () => ({ data: null, error: null }),
            }),
          }),
          insert: (row: Record<string, unknown>) => ({
            select: () => ({
              single: async () => ({ data: { id: 'msg-1', ...row }, error: null }),
            }),
          }),
          update: () => ({ eq: async () => ({ error: null }) }),
        };
      },
    } as unknown as SupabaseClient;

    await sendMessageToConversation(db, 'acct-1', {
      conversationId: 'cv-grupo',
      messageType: 'text',
      contentText: 'bom dia',
      senderUserId: 'user-1',
    });

    expect(sendText).toHaveBeenCalledWith(
      expect.objectContaining({ text: '*Ramon Paula:*\nbom dia' }),
    );
  });
```

- [ ] **Step 2: Rodar**

Run: `npx vitest run src/lib/whatsapp/send-message.test.ts`

Dois desfechos possíveis, ambos aceitáveis — reporte qual ocorreu:
- **Passa de primeira:** a assinatura já funciona em grupo. É caracterização; nenhuma mudança de produção é necessária. Diga isso no relatório, sem inventar um RED que não houve.
- **Falha:** investigue por quê (provavelmente a consulta a `profiles` em `sendMessageToConversation` está dentro de um ramo que grupo não alcança) e corrija com a mudança mínima.

- [ ] **Step 3: Suíte completa + typecheck**

Run: `npx vitest run` e `npx tsc --noEmit` — saída real no relatório.

- [ ] **Step 4: Commit**

```bash
git add src/lib/whatsapp/send-message.test.ts src/lib/whatsapp/send-message.ts
git commit -m "test(grupos): prova que a assinatura do atendente vale em grupo"
```

(Se nenhuma mudança de produção foi necessária, commite só o arquivo de teste.)

---

### Task 3: Destravar o composer em conversa de grupo

**Files:**
- Modify: `src/components/inbox/message-thread.tsx`
- Modify: `src/components/inbox/message-composer.tsx`

**Interfaces:**
- Consumes: envio de grupo funcionando (Tarefas 1-2).

- [ ] **Step 1: Parar de bloquear o composer**

Em `message-thread.tsx`, na renderização do `MessageComposer` (por volta da linha 1349), remover as duas props que hoje travam o envio:

```typescript
        groupReadOnly={!!conversation.group_id}
        groupReadOnlyText={tGroups("readOnly")}
```

Se `tGroups` ficar sem nenhum outro uso no arquivo depois disso, remover também a declaração dele — variável não usada quebra o lint.

- [ ] **Step 2: Esconder o construtor de interativo em grupo**

A spec deixa interativo (botões/listas) fora de escopo por decisão de produto. O composer precisa saber que é uma conversa de grupo para esconder essa opção. Em `message-composer.tsx`:

Trocar a prop `groupReadOnly` (que perde o sentido) por `isGroup`, mantendo o mesmo tipo e default:

```typescript
  /**
   * True numa conversa de grupo. Fase 2 permite texto e mídia em grupo,
   * mas o construtor de mensagem interativa fica de fora: botão em grupo
   * tem semântica confusa (qualquer participante pode clicar).
   */
  isGroup?: boolean;
```

Remover `groupReadOnlyText` e todas as suas referências. Remover `groupReadOnly` de `sendBlocked`:

```typescript
  const sendBlocked = channelUnavailable;
```

Remover o banner de somente-leitura (por volta da linha 614) e todos os ramos ternários que exibiam `groupReadOnlyText` em `title`/tooltip (linhas ~715, 757, 789, 809, 831, 848) — em cada um, o ramo de grupo simplesmente sai, deixando o comportamento que já existia para 1:1.

Esconder o item de interativo no menu (por volta da linha 768):

```typescript
              {!isGroup && (
                <DropdownMenuItem onClick={() => openInteractiveBuilder()}>
                  <MessageSquareDashed className="mr-2 h-4 w-4" />
                  {t("interactiveMessage")}
                </DropdownMenuItem>
              )}
```

Em `message-thread.tsx`, passar a prop nova:

```typescript
        isGroup={!!conversation.group_id}
```

- [ ] **Step 3: Verificar que nada ficou órfão**

```bash
grep -rn "groupReadOnly" src/
```
Esperado: nenhum resultado. Se sobrar alguma referência, resolva antes de seguir.

A chave de i18n `Settings.groups.readOnly` continua sendo usada na aba de Configurações (`groups-manager.tsx`) — **não remova** a chave dos arquivos de tradução.

- [ ] **Step 4: Suíte completa + typecheck + lint**

Run: `npx vitest run` — só as 5 falhas pré-existentes.
Run: `npx tsc --noEmit` — saída real no relatório.
Run: `npx eslint src/components/inbox/message-composer.tsx src/components/inbox/message-thread.tsx` — sem erros novos.

- [ ] **Step 5: Commit**

```bash
git add src/components/inbox/message-composer.tsx src/components/inbox/message-thread.tsx
git commit -m "feat(grupos): libera o composer em conversa de grupo"
```

---

### Task 4: Verificação ponta a ponta em homologação

**Files:** nenhum (validação).

Esta tarefa é do coordenador do plano com o usuário real — um implementador automatizado não tem credenciais de login no CRM. A Fase 1 provou que essa verificação pega bugs que nenhum teste com fake pega (um `status` inválido e um join faltando escaparam de 823 testes verdes).

- [ ] **Step 1: Publicar em homologação**

```bash
git push origin <branch>:staging
npx vercel ls
npx vercel alias set <deployment-novo> wacrm-git-staging-ramonppaula-5619s-projects.vercel.app
npx vercel inspect wacrm-git-staging-ramonppaula-5619s-projects.vercel.app
```

⚠️ O alias de homologação **não** atualiza sozinho — confirmar que a data do deployment é a de agora. Isso já custou horas de depuração numa entrega anterior.

- [ ] **Step 2: Verificar os critérios de aceite com o usuário**

1. Enviar texto numa conversa de grupo pelo CRM → chega no grupo real do WhatsApp.
2. A mensagem chega **assinada** com `*Nome Sobrenome:*`.
3. Enviar mídia (imagem/documento) em grupo → chega, com legenda assinada quando houver.
4. A mensagem enviada aparece na thread do CRM, atribuída ao operador.
5. Conferir no banco que nada foi criado/alterado em `contacts`:
   ```sql
   SELECT COUNT(*) FROM contacts WHERE updated_at > '<momento do teste>';
   ```
   Esperado: `0`.
6. Enviar e receber numa conversa 1:1 → comportamento idêntico ao de antes.
7. Confirmar que o menu do composer **não** oferece "mensagem interativa" em grupo.
8. Mandar mensagem no grupo pelo WhatsApp (recebida) → continua não acionando automação/fluxo/IA.

- [ ] **Step 3: Decidir sobre produção**

Só depois de todos os critérios passarem. A decisão de abrir PR e promover é do usuário — **não** promover por iniciativa própria.

Lembrar: a Fase 1 ainda não está em produção (decisão do usuário de 2026-09-03, aguardando o plano completo ficar ativo). Quando for promover, as migrations da Fase 1 (`20260829000001_whatsapp_groups.sql`, `20260903000001_group_default_enabled.sql`) precisam ser aplicadas à mão em produção — a integração Supabase→GitHub aponta para `main` abandonada. A Fase 2 não acrescenta migration nenhuma.

---

## Notas de execução

- **A Tarefa 1 é o núcleo.** Se o isolamento da retentativa de telefone (Step 5) ficar mal feito, o sintoma é quebra em runtime com `contact` nulo — o teste "NAO toca na tabela contacts" existe exatamente para pegar isso.
- **Nada de migration nesta fase.** Se surgir a impressão de que falta uma, é sinal de que algo foi mal entendido — pare e reavalie.
- **A trava dos motores não se toca.** Ela é sobre mensagem recebida; esta fase é sobre mensagem enviada.
- **O alias de homologação exige `vercel alias set` a cada deploy.**

# Grupos de WhatsApp no CRM — Fase 2 (envio)

**Data:** 2026-09-03
**Status:** proposto, aguardando revisão
**Escopo desta spec:** apenas a Fase 2. Gestão de grupo (sair, adicionar/
remover participante, renomear) é Fase 3, com spec própria.
**Depende de:** Fase 1 (`2026-08-28-grupos-whatsapp-fase1-design.md`),
entregue e verificada em homologação.

---

## 1. Problema

A Fase 1 entregou leitura: grupos selecionados aparecem na inbox, com o
autor de cada mensagem identificado. Mas o composer fica desabilitado —
o operador lê e não responde. Para o CRM ser útil em grupo, falta enviar.

### O que já foi provado (não é suposição)

Antes de escrever esta spec, testei o envio real contra a instância
uazapi de homologação, mandando texto para o JID do grupo de teste:

- `POST /send/text` com `number: "120363429748080632@g.us"` → **HTTP 200**,
  resposta com `isGroup: true` e `chatid` correto.
- `POST /send/text` com `number: "120363429748080632"` (só dígitos, sem
  o sufixo) → **HTTP 200**, mesma resposta.

Ou seja: **a uazapi aceita grupo no mesmo campo `number` que já recebe
telefone, e normaliza o sufixo sozinha.** Não é preciso método novo no
provider (`sendText`/`sendMedia` servem como estão), nem endpoint novo,
nem mudança no adaptador uazapi.

### Onde está o bloqueio real

Todo o impedimento é do **nosso** código, concentrado em
`sendMessageToConversation` (`src/lib/whatsapp/send-message.ts`):

1. **Linha ~234:** `if (!contact?.phone) throw` — conversa de grupo tem
   `contact_id` nulo por construção (`conversations_contact_xor_group`),
   então nunca passa daqui.
2. **Linha ~244:** `isValidE164(sanitizedPhone)` — o JID de grupo tem 18+
   dígitos; a validação aceita no máximo 15. Mesmo contornando o passo 1,
   o destino seria recusado aqui.
3. **Linhas ~399-436:** a retentativa de variantes de telefone
   (`phoneVariants`) e a auto-correção que grava o número que funcionou
   de volta em `contacts` — ambas sem sentido para grupo, e a segunda
   escreveria numa tabela que grupo nem referencia.

E na UI, `message-thread.tsx:1349` passa `groupReadOnly={!!conversation.group_id}`
ao composer, que desabilita todos os controles de envio.

---

## 2. Decisões já tomadas

| Decisão | Escolha |
| --- | --- |
| Assinatura do atendente | **Sim** — mesma do 1:1 (`*Nome Sobrenome:*`) |
| Tipos de mensagem | **Texto e mídia** na mesma etapa |
| Gestão de grupo | Fora de escopo (Fase 3) |

A assinatura importa mais em grupo do que no 1:1: numa conversa com
várias pessoas, sem ela ninguém sabe qual atendente respondeu. Reaproveita
`withAgentSignature` sem alteração.

---

## 3. Desenho

### 3.1 Resolução do destino em `sendMessageToConversation`

A função passa a resolver o destino por um de dois caminhos, decidido
pela presença de `group_id` na conversa:

```
conversa carregada
      │
      ├── group_id presente ──→ destino = whatsapp_groups.group_jid
      │                          (sem validação E.164, sem variantes)
      │
      └── contact_id presente ─→ destino = contact.phone
                                 (caminho atual, intocado)
```

A query de conversa passa a embutir o grupo, como a inbox já faz:

```ts
.select('*, contact:contacts(*), group:whatsapp_groups(id, group_jid)')
```

Ausência de destino nos dois caminhos continua sendo erro
`bad_request` — apenas a mensagem fica específica ("Group not found for
this conversation" vs. o atual "Contact phone number not found").

### 3.2 Retentativa de variantes: só no caminho 1:1

`phoneVariants` existe para o sandbox da Meta rejeitar número por trunk
prefix — um problema de telefone, não de grupo. Em grupo, o envio é uma
tentativa única com o JID; qualquer erro do provider sobe como
`meta_error`, sem retentativa.

A auto-correção que grava o número que funcionou de volta em `contacts`
também roda **apenas** no caminho 1:1 — grupo não tem contato para
corrigir.

> **Risco a evitar na implementação.** O bloco de retentativa e o de
> auto-correção referenciam `contact.id` e `sanitizedPhone`. Se o branch
> de grupo cair dentro deles, quebra em runtime com `contact` nulo. A
> separação precisa ser estrutural (um `if` que envolve os dois blocos),
> não uma variável que "por acaso" fica indefinida.

### 3.3 Assinatura

Nenhuma mudança. `withAgentSignature` já é aplicado antes do envio, com
base em `senderUserId` (sempre presente quando um humano envia pelo
dashboard) — vale igual para grupo. Automação, fluxo, IA e API pública
continuam sem assinatura, como hoje.

### 3.4 Persistência

Idêntica ao 1:1: a mensagem é gravada em `messages` com
`sender_type: 'agent'`, `sender_id` do operador, e o `conversation_id`
da conversa de grupo. `participant_id` fica nulo — ele identifica quem
escreveu numa mensagem **recebida**; mensagem enviada é do nosso time, e
o autor já vem de `sender_id`.

### 3.5 UI

`message-thread.tsx:1349` para de passar `groupReadOnly` (e o texto
correspondente). O composer volta ao comportamento normal: texto, mídia,
anexos e resposta com citação.

A prop `groupReadOnly` do composer fica **sem nenhum consumidor** depois
disso. Removê-la ou mantê-la é decisão do plano de implementação, não
desta spec — mas deixá-la órfã sem decisão explícita é o que não pode
acontecer.

---

## 4. O que NÃO muda — e por quê importa

**A trava que impede automação, fluxo e IA de responderem em grupo
(`shouldDispatchEngines`, Fase 1) permanece exatamente como está.**

Ela protege mensagens **recebidas**: um motor automático respondendo
sozinho dentro de um grupo é o erro irreversível que a Fase 1 evitou.
Enviar pelo composer é ação humana, deliberada e rastreável — não passa
por aquele caminho. A Fase 2 não afrouxa essa proteção em nada, e nenhuma
tarefa deve tocar em `shouldDispatchEngines`.

Também não mudam: o opt-in por grupo (`whatsapp_groups.enabled`), a
proteção contra descoberta passiva de grupo desconhecido, e a regra de
participante nunca virar contato.

---

## 5. Fora de escopo

- Sair do grupo, adicionar/remover participante, renomear (Fase 3)
- Mencionar participante (`@fulano`)
- Responder citando uma mensagem específica de um participante
- Grupo em broadcasts, automações, fluxos ou IA

### Template e interativo: dois casos diferentes

Não são o mesmo problema, e a spec original os tratava como se fossem:

- **Template** já é recusado pelo próprio provider uazapi
  (`sendTemplate` lança `ProviderUnsupportedError`, `uazapi.ts:134-138`),
  para grupo **e** para 1:1. Não há nada a fazer nesta fase — o erro
  existente já é claro e chega antes de qualquer chamada externa.
- **Interativo** (botões/listas) **é** suportado pela uazapi
  (`sendInteractiveButtons`/`sendInteractiveList`), então tecnicamente
  funcionaria em grupo. Fica fora de escopo por decisão de produto (não
  foi pedido, e botão em grupo tem semântica confusa: qualquer um dos
  participantes pode clicar), não por impedimento técnico.

Consequência para a implementação: **não** é preciso escrever uma recusa
nova para template. Para interativo, a decisão é deixar como está — o
composer da Fase 2 não oferece o construtor de interativo em conversa de
grupo, e nenhuma trava extra no backend é necessária, já que a UI é o
único caminho que chegaria lá.

---

## 6. Riscos

| Risco | Mitigação |
| --- | --- |
| Branch de grupo cair no bloco de variantes/auto-correção e quebrar com `contact` nulo | Separação estrutural (§3.2), com teste cobrindo envio em grupo sem nenhum acesso a `contacts` |
| Regressão no envio 1:1 | O caminho 1:1 não muda; suíte completa antes de cada commit |
| Mensagem enviada em grupo sem assinatura | Teste afirmando o texto assinado no payload do provider, como já existe no 1:1 |
| Interativo (botões/listas) sendo enviado em grupo sem ter sido pensado para isso | O composer não oferece o construtor de interativo em conversa de grupo; nenhuma trava extra necessária no backend (a UI é o único caminho até lá) |

---

## 7. Critérios de aceite

1. Operador envia texto numa conversa de grupo pelo CRM e a mensagem
   chega no grupo real do WhatsApp.
2. A mensagem chega **assinada** com `*Nome Sobrenome:*` do atendente.
3. Operador envia mídia (imagem, vídeo, documento, áudio) em grupo e ela
   chega, com a legenda também assinada quando houver.
4. A mensagem enviada aparece na thread do CRM, atribuída ao operador
   que enviou.
5. Nenhum registro é criado ou alterado em `contacts` ao enviar em grupo.
6. Envio 1:1 segue idêntico — nenhuma regressão.
7. O composer não oferece o construtor de mensagem interativa
   (botões/listas) numa conversa de grupo.
8. Mensagem **recebida** de grupo continua não acionando automação, fluxo
   nem IA.

import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { resolveGroupConversation } from './resolve-group-conversation';

const GROUP = {
  groupJid: '120363000000000000@g.us',
  participantJid: '5511999999999@s.whatsapp.net',
  participantName: 'Fulano',
};

// ============================================================
// Fake Supabase COM ESTADO. As tabelas ficam em memória entre chamadas,
// para provar idempotência e as mesclas de linha órfã por asserção
// direta sobre o estado, não por suposição sobre o código.
// ============================================================

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

class FakeQuery {
  private conds: ((row: Row) => boolean)[] = [];
  private mode: 'select' | 'insert' | 'upsert' | 'update' | 'delete' = 'select';
  private payload: Row | null = null;
  private onConflictCols: string[] | null = null;

  constructor(
    private readonly db: FakeDb,
    private readonly table: string,
  ) {}

  private get rows(): Row[] {
    if (!this.db.tables[this.table]) this.db.tables[this.table] = [];
    return this.db.tables[this.table];
  }

  select() {
    return this;
  }

  insert(payload: Row) {
    this.mode = 'insert';
    this.payload = payload;
    return this;
  }

  upsert(payload: Row, opts?: { onConflict?: string }) {
    this.mode = 'upsert';
    this.payload = payload;
    this.onConflictCols = opts?.onConflict ? opts.onConflict.split(',') : null;
    return this;
  }

  update(payload: Row) {
    this.mode = 'update';
    this.payload = payload;
    return this;
  }

  delete() {
    this.mode = 'delete';
    return this;
  }

  eq(col: string, val: unknown) {
    this.conds.push((r) => r[col] === val);
    return this;
  }

  is(col: string, val: unknown) {
    this.conds.push((r) => r[col] === val);
    return this;
  }

  single() {
    const res = this.run();
    const arr = (res.data as Row[] | null) ?? [];
    if (res.error) return Promise.resolve(res);
    if (arr.length !== 1) {
      return Promise.resolve({
        data: null,
        error: { code: 'PGRST116', message: 'expected exactly one row' },
      });
    }
    return Promise.resolve({ data: arr[0], error: null });
  }

  maybeSingle() {
    const res = this.run();
    const arr = (res.data as Row[] | null) ?? [];
    if (res.error) return Promise.resolve(res);
    if (arr.length > 1) {
      return Promise.resolve({
        data: null,
        error: { code: 'PGRST116', message: 'multiple rows returned' },
      });
    }
    return Promise.resolve({ data: arr[0] ?? null, error: null });
  }

  // Torna a query "then-avel": um SELECT/UPDATE/DELETE sem `.single()`/
  // `.maybeSingle()` no final (como o supabase-js de verdade) resolve
  // direto num `await`, sem chamada terminal explícita.
  then<TResult1 = { data: Row[] | null; error: Row | null }, TResult2 = never>(
    onfulfilled?:
      | ((value: { data: Row[] | null; error: Row | null }) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.run()).then(onfulfilled, onrejected);
  }

  private run(): { data: Row[] | null; error: Row | null } {
    if (this.mode === 'insert') {
      const created: Row = { id: `${this.table}-${this.db.nextId++}`, ...this.payload };
      this.rows.push(created);
      return { data: [created], error: null };
    }

    if (this.mode === 'upsert') {
      const cols = this.onConflictCols ?? [];
      const existing = this.rows.find((r) => cols.every((c) => r[c] === this.payload![c]));
      if (existing) {
        Object.assign(existing, this.payload);
        return { data: [existing], error: null };
      }
      const created: Row = { id: `${this.table}-${this.db.nextId++}`, ...this.payload };
      this.rows.push(created);
      return { data: [created], error: null };
    }

    if (this.mode === 'update') {
      const matched = this.rows.filter((r) => this.conds.every((c) => c(r)));
      matched.forEach((r) => Object.assign(r, this.payload));
      return { data: matched, error: null };
    }

    if (this.mode === 'delete') {
      const matched = this.rows.filter((r) => this.conds.every((c) => c(r)));
      this.db.tables[this.table] = this.rows.filter((r) => !matched.includes(r));
      return { data: matched, error: null };
    }

    const matched = this.rows.filter((r) => this.conds.every((c) => c(r)));
    return { data: matched, error: null };
  }
}

class FakeDb {
  tables: Record<string, Row[]> = {};
  nextId = 1;

  from(table: string) {
    return new FakeQuery(this, table);
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

describe('resolveGroupConversation', () => {
  it('registra o grupo desconhecido como desabilitado e NAO cria conversa', async () => {
    // Assim a tela de selecao descobre os grupos existentes sem que
    // eles apareçam na inbox antes de alguem autorizar.
    const db = new FakeDb();

    const r = await resolveGroupConversation(
      db as unknown as SupabaseClient,
      'acct-1',
      'ch-1',
      'user-1',
      GROUP,
    );

    expect(r).toBeNull();
    expect(db.tables['whatsapp_groups']?.[0]).toMatchObject({
      group_jid: GROUP.groupJid,
      channel_id: 'ch-1',
      enabled: false,
    });
    expect(db.tables['conversations']).toBeUndefined();
  });

  it('descarta mensagem de grupo conhecido porem desabilitado', async () => {
    const db = new FakeDb();
    db.tables['whatsapp_groups'] = [
      { id: 'grp-1', account_id: 'acct-1', channel_id: 'ch-1', group_jid: GROUP.groupJid, enabled: false },
    ];

    const r = await resolveGroupConversation(
      db as unknown as SupabaseClient,
      'acct-1',
      'ch-1',
      'user-1',
      GROUP,
    );

    expect(r).toBeNull();
    expect(db.tables['conversations']).toBeUndefined();
  });

  it('cria conversa e participante quando o grupo esta habilitado', async () => {
    const db = new FakeDb();
    db.tables['whatsapp_groups'] = [
      { id: 'grp-1', account_id: 'acct-1', channel_id: 'ch-1', group_jid: GROUP.groupJid, enabled: true },
    ];

    const r = await resolveGroupConversation(
      db as unknown as SupabaseClient,
      'acct-1',
      'ch-1',
      'user-1',
      GROUP,
    );

    expect(r).not.toBeNull();
    expect(r!.groupId).toBe('grp-1');
    // Conversa de grupo tem contact_id nulo — o CHECK do banco exige
    // exatamente um entre contact_id e group_id.
    expect(db.tables['conversations']?.[0]).toMatchObject({
      group_id: 'grp-1',
      contact_id: null,
    });
    expect(db.tables['group_participants']?.[0]).toMatchObject({
      participant_jid: GROUP.participantJid,
      phone: '5511999999999',
    });
  });

  it('perde uma corrida contra outro criador (ex.: botao Conversar) e reaproveita a conversa vencedora', async () => {
    // Mesma corrida de find-or-create-conversation.test.ts, do outro
    // lado: uma mensagem recebida via webhook e um clique em "Conversar"
    // (findOrCreateConversationForGroup) podem resolver "não existe
    // ainda" ao mesmo tempo para o mesmo grupo. Sem tratar o 23505 aqui,
    // a mensagem recebida seria DESCARTADA (ingest.ts trata
    // resolveGroupConversation === null como "nada a fazer") — pior que
    // o 500 genérico do lado do botão.
    let conversationSelectCalls = 0;
    const db = {
      from: (table: string) => ({
        select: () => ({
          eq: () => ({
            eq: () => {
              if (table === 'whatsapp_groups') {
                return Promise.resolve({
                  data: [{ id: 'grp-1', channel_id: 'ch-1', enabled: true }],
                  error: null,
                });
              }
              return {
                eq: () => ({
                  maybeSingle: async () => {
                    conversationSelectCalls += 1;
                    return conversationSelectCalls === 1
                      ? { data: null, error: null }
                      : { data: { id: 'conv-winner' }, error: null };
                  },
                }),
              };
            },
          }),
        }),
        insert: () => ({
          select: () => ({
            single: async () => ({
              data: null,
              error: {
                code: '23505',
                message:
                  'duplicate key value violates unique constraint "idx_conversations_account_group_channel"',
              },
            }),
          }),
        }),
        upsert: () => ({
          select: () => ({
            single: async () => ({ data: { id: 'participant-1' }, error: null }),
          }),
        }),
      }),
    } as unknown as SupabaseClient;

    const r = await resolveGroupConversation(db, 'acct-1', 'ch-1', 'user-1', GROUP);

    expect(r).not.toBeNull();
    expect(r!.conversationId).toBe('conv-winner');
  });

  it('grava phone nulo quando o participante e @lid', async () => {
    // O WhatsApp entrega participantes como @lid (identificador opaco,
    // sem telefone) cada vez mais. Gravar o LID como telefone criaria
    // contato/numero falso.
    const db = new FakeDb();
    db.tables['whatsapp_groups'] = [
      { id: 'grp-1', account_id: 'acct-1', channel_id: 'ch-1', group_jid: GROUP.groupJid, enabled: true },
    ];

    await resolveGroupConversation(db as unknown as SupabaseClient, 'acct-1', 'ch-1', 'user-1', {
      ...GROUP,
      participantJid: '98765432100000@lid',
    });

    expect(db.tables['group_participants']?.[0]).toMatchObject({ phone: null });
  });
});

describe('resolveGroupConversation — idempotência (upsert / find-or-create)', () => {
  it('segunda mensagem do MESMO participante no MESMO grupo reaproveita o participant_id', async () => {
    // Regressão do bug Crítico: group_participants tem UNIQUE (group_id,
    // participant_jid). Um insert cego violaria essa constraint na
    // segunda mensagem do mesmo participante — e o erro não era checado,
    // então a função devolvia null silenciosamente.
    const db = new FakeDb();
    db.tables['whatsapp_groups'] = [
      { id: 'grp-1', account_id: 'acct-1', channel_id: 'ch-1', group_jid: GROUP.groupJid, enabled: true },
    ];

    const r1 = await resolveGroupConversation(db as unknown as SupabaseClient, 'acct-1', 'ch-1', 'user-1', GROUP);
    const r2 = await resolveGroupConversation(db as unknown as SupabaseClient, 'acct-1', 'ch-1', 'user-1', GROUP);

    expect(r1).not.toBeNull();
    expect(r2).not.toBeNull();
    expect(r2!.participantId).toBe(r1!.participantId);
    expect(db.tables['group_participants']).toHaveLength(1);
  });

  it('segunda mensagem de QUALQUER participante no MESMO grupo reaproveita o conversation_id', async () => {
    // Regressão do bug Crítico: conversations tem UNIQUE NULLS NOT
    // DISTINCT (account_id, group_id, channel_id) WHERE group_id IS NOT
    // NULL. Um insert cego violaria essa constraint na segunda mensagem
    // de QUALQUER participante do mesmo grupo.
    const db = new FakeDb();
    db.tables['whatsapp_groups'] = [
      { id: 'grp-1', account_id: 'acct-1', channel_id: 'ch-1', group_jid: GROUP.groupJid, enabled: true },
    ];

    const r1 = await resolveGroupConversation(db as unknown as SupabaseClient, 'acct-1', 'ch-1', 'user-1', GROUP);
    const r2 = await resolveGroupConversation(db as unknown as SupabaseClient, 'acct-1', 'ch-1', 'user-1', {
      ...GROUP,
      participantJid: '5511888888888@s.whatsapp.net',
      participantName: 'Outro Participante',
    });

    expect(r1).not.toBeNull();
    expect(r2).not.toBeNull();
    expect(r2!.conversationId).toBe(r1!.conversationId);
    expect(db.tables['conversations']).toHaveLength(1);
    // Participantes diferentes ainda geram linhas diferentes em
    // group_participants — só a conversa é compartilhada.
    expect(db.tables['group_participants']).toHaveLength(2);
  });

  it('nao apaga display_name ja conhecido quando uma mensagem seguinte chega sem participantName', async () => {
    // Regressão do bug Importante: normalize.ts só preenche
    // participantName quando o evento da uazapi traz senderName/pushName
    // (ambos opcionais). Um upsert que sempre grava
    // `display_name: group.participantName ?? null` sobrescreveria um
    // nome já resolvido com null assim que uma mensagem sem esse campo
    // chegasse — mesmo participante, mesmo grupo.
    const db = new FakeDb();
    db.tables['whatsapp_groups'] = [
      { id: 'grp-1', account_id: 'acct-1', channel_id: 'ch-1', group_jid: GROUP.groupJid, enabled: true },
    ];

    const r1 = await resolveGroupConversation(db as unknown as SupabaseClient, 'acct-1', 'ch-1', 'user-1', GROUP);
    const r2 = await resolveGroupConversation(db as unknown as SupabaseClient, 'acct-1', 'ch-1', 'user-1', {
      groupJid: GROUP.groupJid,
      participantJid: GROUP.participantJid,
      // participantName ausente, como em vários tipos de evento da uazapi.
    });

    expect(r1).not.toBeNull();
    expect(r2).not.toBeNull();
    expect(r2!.participantId).toBe(r1!.participantId);
    expect(db.tables['group_participants']).toHaveLength(1);
    expect(db.tables['group_participants'][0].display_name).toBe('Fulano');
  });
});

describe('resolveGroupConversation — cura de grupo órfão (canal recriado)', () => {
  // Achado ao vivo em 2026-09-15: a instância UAZAPI foi recriada em
  // homolog (id novo, mesmo número), e todo grupo antes habilitado ficou
  // órfão (channel_id nulo, via ON DELETE SET NULL). Sem esta cura, cada
  // mensagem nova criava uma segunda linha desabilitada pro canal atual
  // e a descartava — a órfã continuava marcada "ligada" na tela de
  // Configurações, sem nunca mais receber nada.
  it('cura a linha órfã (adota o canal atual) e usa o enabled dela', async () => {
    const db = new FakeDb();
    db.tables['whatsapp_groups'] = [
      { id: 'grp-orfao', account_id: 'acct-1', channel_id: null, group_jid: GROUP.groupJid, enabled: true },
    ];

    const r = await resolveGroupConversation(
      db as unknown as SupabaseClient,
      'acct-1',
      'ch-novo',
      'user-1',
      GROUP,
    );

    expect(r).not.toBeNull();
    expect(r!.groupId).toBe('grp-orfao');
    expect(db.tables['whatsapp_groups']).toHaveLength(1);
    expect(db.tables['whatsapp_groups'][0]).toMatchObject({
      id: 'grp-orfao',
      channel_id: 'ch-novo',
      enabled: true,
    });
    expect(db.tables['conversations']?.[0]).toMatchObject({ group_id: 'grp-orfao' });
  });

  it('funde uma linha duplicada do canal atual (criada antes desta correção) dentro da órfã', async () => {
    const db = new FakeDb();
    db.tables['whatsapp_groups'] = [
      { id: 'grp-orfao', account_id: 'acct-1', channel_id: null, group_jid: GROUP.groupJid, enabled: true },
      { id: 'grp-duplicado', account_id: 'acct-1', channel_id: 'ch-novo', group_jid: GROUP.groupJid, enabled: false },
    ];
    // Uma conversa já presa na linha duplicada e desabilitada.
    db.tables['conversations'] = [
      { id: 'conv-presa', account_id: 'acct-1', group_id: 'grp-duplicado', channel_id: 'ch-novo', contact_id: null },
    ];

    const r = await resolveGroupConversation(
      db as unknown as SupabaseClient,
      'acct-1',
      'ch-novo',
      'user-1',
      GROUP,
    );

    // A órfã sobrevive (é ela quem carrega o enabled real); a duplicada
    // desaparece e sua conversa é repontada para a sobrevivente.
    expect(r).not.toBeNull();
    expect(r!.groupId).toBe('grp-orfao');
    expect(db.tables['whatsapp_groups']).toHaveLength(1);
    expect(db.tables['whatsapp_groups'][0].id).toBe('grp-orfao');
    const conv = db.tables['conversations'].find((c) => c.id === 'conv-presa');
    expect(conv?.group_id).toBe('grp-orfao');
  });

  it('sem órfã, usa normalmente a linha já escopada pro canal atual', async () => {
    const db = new FakeDb();
    db.tables['whatsapp_groups'] = [
      { id: 'grp-1', account_id: 'acct-1', channel_id: 'ch-1', group_jid: GROUP.groupJid, enabled: true },
    ];

    const r = await resolveGroupConversation(
      db as unknown as SupabaseClient,
      'acct-1',
      'ch-1',
      'user-1',
      GROUP,
    );

    expect(r).not.toBeNull();
    expect(r!.groupId).toBe('grp-1');
    expect(db.tables['whatsapp_groups']).toHaveLength(1);
  });
});

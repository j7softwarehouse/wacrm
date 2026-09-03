import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

import { resolveGroupConversation } from './resolve-group-conversation';

const GROUP = {
  groupJid: '120363000000000000@g.us',
  participantJid: '5511999999999@s.whatsapp.net',
  participantName: 'Fulano',
};

function fakeDb(opts: {
  group: { id: string; enabled: boolean } | null;
  inserted: Record<string, unknown[]>;
}) {
  const inserted = opts.inserted;
  return {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: table === 'whatsapp_groups' ? opts.group : null,
                error: null,
              }),
            }),
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        }),
      }),
      insert: (row: Record<string, unknown>) => {
        (inserted[table] ??= []).push(row);
        return {
          select: () => ({
            single: async () => ({ data: { id: `${table}-1`, ...row }, error: null }),
          }),
        };
      },
      // Estes 4 testes não exercitam conflito (cada um chama a função uma
      // única vez), então upsert aqui só precisa se comportar como insert.
      // A idempotência de verdade (reaproveitar linha existente) é provada
      // pelo describe de baixo, com um fake que mantém estado.
      upsert: (row: Record<string, unknown>) => {
        (inserted[table] ??= []).push(row);
        return {
          select: () => ({
            single: async () => ({ data: { id: `${table}-1`, ...row }, error: null }),
          }),
        };
      },
      update: () => ({ eq: async () => ({ error: null }) }),
    }),
  } as unknown as SupabaseClient;
}

describe('resolveGroupConversation', () => {
  it('registra o grupo desconhecido como desabilitado e NAO cria conversa', async () => {
    // Assim a tela de selecao descobre os grupos existentes sem que
    // eles apareçam na inbox antes de alguem autorizar.
    const inserted: Record<string, unknown[]> = {};
    const db = fakeDb({ group: null, inserted });

    const r = await resolveGroupConversation(db, 'acct-1', 'ch-1', 'user-1', GROUP);

    expect(r).toBeNull();
    expect(inserted['whatsapp_groups']?.[0]).toMatchObject({
      group_jid: GROUP.groupJid,
      enabled: false,
    });
    expect(inserted['conversations']).toBeUndefined();
  });

  it('descarta mensagem de grupo conhecido porem desabilitado', async () => {
    const inserted: Record<string, unknown[]> = {};
    const db = fakeDb({ group: { id: 'grp-1', enabled: false }, inserted });

    const r = await resolveGroupConversation(db, 'acct-1', 'ch-1', 'user-1', GROUP);

    expect(r).toBeNull();
    expect(inserted['conversations']).toBeUndefined();
  });

  it('cria conversa e participante quando o grupo esta habilitado', async () => {
    const inserted: Record<string, unknown[]> = {};
    const db = fakeDb({ group: { id: 'grp-1', enabled: true }, inserted });

    const r = await resolveGroupConversation(db, 'acct-1', 'ch-1', 'user-1', GROUP);

    expect(r).not.toBeNull();
    expect(r!.groupId).toBe('grp-1');
    // Conversa de grupo tem contact_id nulo — o CHECK do banco exige
    // exatamente um entre contact_id e group_id.
    expect(inserted['conversations']?.[0]).toMatchObject({
      group_id: 'grp-1',
      contact_id: null,
    });
    expect(inserted['group_participants']?.[0]).toMatchObject({
      participant_jid: GROUP.participantJid,
      phone: '5511999999999',
    });
  });

  it('grava phone nulo quando o participante e @lid', async () => {
    // O WhatsApp entrega participantes como @lid (identificador opaco,
    // sem telefone) cada vez mais. Gravar o LID como telefone criaria
    // contato/numero falso.
    const inserted: Record<string, unknown[]> = {};
    const db = fakeDb({ group: { id: 'grp-1', enabled: true }, inserted });

    await resolveGroupConversation(db, 'acct-1', 'ch-1', 'user-1', {
      ...GROUP,
      participantJid: '98765432100000@lid',
    });

    expect(inserted['group_participants']?.[0]).toMatchObject({ phone: null });
  });
});

// ============================================================
// Fake Supabase COM ESTADO — necessário para provar idempotência.
//
// O `fakeDb` acima devolve um `id` sintético a cada `insert`/`upsert`
// sem nunca checar se a linha já existe, então ele não consegue provar
// nada sobre reaproveitar uma linha entre duas chamadas. Este fake
// mantém as tabelas em memória entre chamadas (mesmo padrão de
// `src/lib/whatsapp/inbound/ingest.test.ts`, adaptado para as tabelas
// `whatsapp_groups` / `group_participants` / `conversations`), então
// "a segunda chamada não criou uma segunda linha" vira uma asserção
// direta sobre o estado do fake, não uma suposição sobre o código.
// ============================================================

/* eslint-disable @typescript-eslint/no-explicit-any */
type Row = Record<string, any>;

class FakeQuery {
  private conds: ((row: Row) => boolean)[] = [];
  private mode: 'select' | 'insert' | 'upsert' = 'select';
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

  eq(col: string, val: unknown) {
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

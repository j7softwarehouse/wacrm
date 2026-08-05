import { describe, it, expect, vi, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

import { loadAwaitingReply } from './queries'

// --------------------------------------------------------------
// loadAwaitingReply combina três fontes de risco: o gate de
// expediente (isWithinBusinessHours), o filtro por remetente
// ('customer' vs 'agent'/'bot') e o limiar de > 30 minutos de
// expediente (businessMinutesBetween). Os testes usam a aritmética
// REAL de business-hours.ts (não mockada) e só simulam o `db.rpc`,
// no mesmo padrão de src/lib/ai/knowledge.test.ts.
//
// Datas em UTC explícito, igual a business-hours.test.ts: expediente
// é 07:00–19:00 em America/Sao_Paulo = 10:00–22:00 UTC.
// --------------------------------------------------------------

interface FakeState {
  rows: { last_message_at: string | null; last_sender_type: string | null }[]
  rpcError: { message: string } | null
  rpcCalls: string[]
}

function makeDb() {
  const state: FakeState = {
    rows: [],
    rpcError: null,
    rpcCalls: [],
  }
  const db = {
    rpc: (name: string) => {
      state.rpcCalls.push(name)
      if (state.rpcError) return Promise.resolve({ data: null, error: state.rpcError })
      return Promise.resolve({ data: state.rows, error: null })
    },
  }
  return { db: db as unknown as SupabaseClient, state }
}

describe('loadAwaitingReply', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('fora do expediente devolve zero sem chamar o RPC', async () => {
    // Sábado 12:00 São Paulo = 15:00 UTC — fora do expediente (fds).
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-01T15:00:00Z'))

    const { db, state } = makeDb()
    const out = await loadAwaitingReply(db, 'acct-1')

    expect(out).toEqual({ count: 0, withinHours: false })
    expect(state.rpcCalls).toEqual([]) // otimização: nem chama o RPC
  })

  it('conta só as conversas cuja última mensagem foi do cliente', async () => {
    // Terça 12:00 São Paulo = 15:00 UTC — dentro do expediente.
    // "1 hora atrás" (14:00 UTC) já passa dos 30 min de expediente.
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-04T15:00:00Z'))

    const { db, state } = makeDb()
    state.rows = [
      { last_message_at: '2026-08-04T14:00:00Z', last_sender_type: 'customer' },
      { last_message_at: '2026-08-04T14:00:00Z', last_sender_type: 'agent' },
      { last_message_at: '2026-08-04T14:00:00Z', last_sender_type: 'bot' },
    ]

    const out = await loadAwaitingReply(db, 'acct-1')

    expect(out).toEqual({ count: 1, withinHours: true })
    expect(state.rpcCalls).toEqual(['conversations_awaiting_reply'])
  })

  it('nao conta uma conversa do cliente com exatamente 29 minutos de expediente', async () => {
    // Terça 12:00 São Paulo = 15:00 UTC. Última msg às 11:31 SP = 14:31 UTC
    // → 29 minutos de expediente decorridos, abaixo do limiar de > 30.
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-04T15:00:00Z'))

    const { db, state } = makeDb()
    state.rows = [
      { last_message_at: '2026-08-04T14:31:00Z', last_sender_type: 'customer' },
    ]

    const out = await loadAwaitingReply(db, 'acct-1')

    expect(out).toEqual({ count: 0, withinHours: true })
  })

  it('conta uma conversa do cliente com 31 minutos de expediente', async () => {
    // Mesma janela, última msg às 11:29 SP = 14:29 UTC → 31 minutos.
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-04T15:00:00Z'))

    const { db, state } = makeDb()
    state.rows = [
      { last_message_at: '2026-08-04T14:29:00Z', last_sender_type: 'customer' },
    ]

    const out = await loadAwaitingReply(db, 'acct-1')

    expect(out).toEqual({ count: 1, withinHours: true })
  })

  it('quando o RPC falha, loga o erro e sinaliza error em vez de fingir "tudo respondido"', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-04T15:00:00Z'))
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    const { db, state } = makeDb()
    state.rpcError = { message: 'function conversations_awaiting_reply does not exist' }

    const out = await loadAwaitingReply(db, 'acct-1')

    // count:0 sozinho seria indistinguível do caso feliz — error:true
    // é o sinal que o chamador usa para não anunciar "sem pendências".
    expect(out).toEqual({ count: 0, withinHours: true, error: true })
    expect(errSpy).toHaveBeenCalledTimes(1)
    const [msg, ctx] = errSpy.mock.calls[0]
    expect(String(msg)).toContain('conversations_awaiting_reply')
    expect(ctx).toMatchObject({ accountId: 'acct-1' })
  })
})

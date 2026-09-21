import { describe, expect, it } from 'vitest';

import {
  businessMinutesBetween,
  isAwaitingReply,
  isWithinBusinessHours,
} from './business-hours';

// Todas as datas em UTC explícito. O expediente é 07:00–19:00 em
// America/Sao_Paulo (UTC−3), ou seja 10:00–22:00 UTC. Escrever os
// fixtures em UTC evita depender do fuso da máquina que roda o teste —
// que é justamente o defeito de date-utils.ts.
const utc = (iso: string) => new Date(iso);

describe('isWithinBusinessHours', () => {
  it('reconhece o meio da manha de uma terca', () => {
    // Terça, 2026-08-04, 09:00 em São Paulo = 12:00 UTC
    expect(isWithinBusinessHours(utc('2026-08-04T12:00:00Z'))).toBe(true);
  });

  it('recusa antes da abertura', () => {
    // 06:59 São Paulo = 09:59 UTC
    expect(isWithinBusinessHours(utc('2026-08-04T09:59:00Z'))).toBe(false);
  });

  it('recusa depois do fechamento', () => {
    // 19:01 São Paulo = 22:01 UTC
    expect(isWithinBusinessHours(utc('2026-08-04T22:01:00Z'))).toBe(false);
  });

  it('recusa sabado e domingo mesmo em horario comercial', () => {
    // Sábado 2026-08-01 e domingo 2026-08-02, 12:00 São Paulo
    expect(isWithinBusinessHours(utc('2026-08-01T15:00:00Z'))).toBe(false);
    expect(isWithinBusinessHours(utc('2026-08-02T15:00:00Z'))).toBe(false);
  });
});

describe('businessMinutesBetween', () => {
  it('conta minutos corridos dentro do mesmo expediente', () => {
    // Terça 09:00 → 09:30 São Paulo
    expect(
      businessMinutesBetween(
        utc('2026-08-04T12:00:00Z'),
        utc('2026-08-04T12:30:00Z'),
      ),
    ).toBe(30);
  });

  it('ignora o intervalo fora do expediente na virada do dia', () => {
    // Terça 18:50 → quarta 07:10 São Paulo.
    // Conta 10 min na terça + 10 min na quarta = 20.
    expect(
      businessMinutesBetween(
        utc('2026-08-04T21:50:00Z'),
        utc('2026-08-05T10:10:00Z'),
      ),
    ).toBe(20);
  });

  it('atravessa o fim de semana sem contar sabado e domingo', () => {
    // Sexta 18:50 → segunda 07:10 São Paulo = 10 + 10 = 20 minutos.
    // É o caso que o cliente levantou: mensagem no fim da sexta não
    // pode acusar dois dias de atraso na segunda de manhã.
    expect(
      businessMinutesBetween(
        utc('2026-07-31T21:50:00Z'),
        utc('2026-08-03T10:10:00Z'),
      ),
    ).toBe(20);
  });

  it('devolve zero para intervalo inteiramente fora do expediente', () => {
    // Sábado 10:00 → domingo 10:00 São Paulo
    expect(
      businessMinutesBetween(
        utc('2026-08-01T13:00:00Z'),
        utc('2026-08-02T13:00:00Z'),
      ),
    ).toBe(0);
  });

  it('devolve zero quando o fim precede o inicio', () => {
    expect(
      businessMinutesBetween(
        utc('2026-08-04T12:30:00Z'),
        utc('2026-08-04T12:00:00Z'),
      ),
    ).toBe(0);
  });

  it('conta um dia inteiro de expediente como 720 minutos', () => {
    // Terça 07:00 → 19:00 São Paulo = 12 horas
    expect(
      businessMinutesBetween(
        utc('2026-08-04T10:00:00Z'),
        utc('2026-08-04T22:00:00Z'),
      ),
    ).toBe(720);
  });

  it('arredonda para baixo intervalos com segundos nao-alinhados', () => {
    // Terça 09:00:00 → 09:00:30 São Paulo = 30 segundos = 0 minutos
    expect(
      businessMinutesBetween(
        utc('2026-08-04T12:00:00Z'),
        utc('2026-08-04T12:00:30Z'),
      ),
    ).toBe(0);
  });
});

// isAwaitingReply extrai a mesma regra de src/lib/dashboard/queries.ts
// (loadAwaitingReply) pra um predicado puro reutilizável — o filtro
// "sem resposta +30min" da Inbox usa a MESMA função, garantindo que
// nunca discorde do cartão do Dashboard.
describe('isAwaitingReply', () => {
  it('conta uma conversa do cliente com 31 minutos de expediente', () => {
    // Terça 12:00 São Paulo = 15:00 UTC. Última msg às 11:29 SP = 14:29 UTC.
    const now = utc('2026-08-04T15:00:00Z');
    expect(
      isAwaitingReply(
        { last_message_at: '2026-08-04T14:29:00Z', last_sender_type: 'customer' },
        now,
      ),
    ).toBe(true);
  });

  it('nao conta com exatamente 29 minutos de expediente', () => {
    const now = utc('2026-08-04T15:00:00Z');
    expect(
      isAwaitingReply(
        { last_message_at: '2026-08-04T14:31:00Z', last_sender_type: 'customer' },
        now,
      ),
    ).toBe(false);
  });

  it('nao conta quando a ultima mensagem foi do agente', () => {
    const now = utc('2026-08-04T15:00:00Z');
    expect(
      isAwaitingReply(
        { last_message_at: '2026-08-04T14:00:00Z', last_sender_type: 'agent' },
        now,
      ),
    ).toBe(false);
  });

  it('nao conta quando a ultima mensagem foi do bot', () => {
    const now = utc('2026-08-04T15:00:00Z');
    expect(
      isAwaitingReply(
        { last_message_at: '2026-08-04T14:00:00Z', last_sender_type: 'bot' },
        now,
      ),
    ).toBe(false);
  });

  it('nao conta sem last_message_at', () => {
    const now = utc('2026-08-04T15:00:00Z');
    expect(isAwaitingReply({ last_message_at: null, last_sender_type: 'customer' }, now)).toBe(
      false,
    );
  });

  it('conta pelo atalho de 7 dias corridos sem rodar aritmetica fina', () => {
    // 1 ano atrás -- teria que passar por centenas de iteracoes de dia
    // em businessMinutesBetween sem o atalho. Testa o RESULTADO; ver
    // queries.test.ts para o raciocinio completo de performance.
    const now = utc('2026-08-04T15:00:00Z');
    const umAnoAtras = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000).toISOString();
    expect(
      isAwaitingReply({ last_message_at: umAnoAtras, last_sender_type: 'customer' }, now),
    ).toBe(true);
  });
});

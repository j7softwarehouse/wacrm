// ============================================================
// Minutos de expediente entre dois instantes.
//
// O fuso é EXPLÍCITO e não pode ser herdado do ambiente: na Vercel o
// servidor roda em UTC e a janela erraria por 3 horas. O módulo
// `date-utils.ts` deste mesmo diretório usa setHours/getDay e é
// justamente por isso que seus testes falham — não reutilizar.
// ============================================================

const TIMEZONE = 'America/Sao_Paulo';
const OPEN_HOUR = 7;
const CLOSE_HOUR = 19;
const MINUTES_PER_STEP = 1;

/** Hora e dia da semana de um instante, lidos no fuso da escola. */
function localParts(at: Date): { weekday: number; minutes: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const parts = fmt.formatToParts(at);
  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? '';

  const weekdayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };

  return {
    weekday: weekdayMap[get('weekday')] ?? 0,
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
  };
}

/** Verdadeiro dentro de seg–sex, 07:00–19:00, no fuso da escola. */
export function isWithinBusinessHours(at: Date): boolean {
  const { weekday, minutes } = localParts(at);
  if (weekday === 0 || weekday === 6) return false;
  return minutes >= OPEN_HOUR * 60 && minutes < CLOSE_HOUR * 60;
}

/**
 * Minutos de expediente decorridos entre `from` e `to`.
 *
 * O relógio PAUSA fora da janela: uma mensagem de sexta às 18:50
 * acumula 10 minutos na sexta e só volta a contar segunda às 07:00 —
 * reflete o tempo de atendimento realmente devido, não o de calendário.
 *
 * Implementação por varredura de minuto. O uso real compara contra 30
 * minutos e para cedo; mesmo o pior caso (um fim de semana inteiro)
 * são poucos milhares de iterações, o que dispensa aritmética de
 * calendário e mantém a função obviamente correta.
 */
export function businessMinutesBetween(from: Date, to: Date): number {
  if (to <= from) return 0;

  let count = 0;
  const cursor = new Date(from);

  while (cursor < to) {
    if (isWithinBusinessHours(cursor)) count += MINUTES_PER_STEP;
    cursor.setUTCMinutes(cursor.getUTCMinutes() + MINUTES_PER_STEP);
  }

  return count;
}

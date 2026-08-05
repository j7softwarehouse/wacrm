// ============================================================
// Minutos de expediente entre dois instantes.
//
// O fuso é EXPLÍCITO e não pode ser herdado do ambiente: na Vercel o
// servidor roda em UTC e a janela erraria por 3 horas. O módulo
// `date-utils.ts` deste mesmo diretório usa setHours/getDay e é
// justamente por isso que seus testes falham — não reutilizar.
//
// Implementação por aritmética de dia, não por varredura de minuto.
// Iteração por dia civil em America/Sao_Paulo é O(dias), não O(minutos).
// ============================================================

const TIMEZONE = 'America/Sao_Paulo';
const OPEN_HOUR = 7;
const CLOSE_HOUR = 19;

// Reutilizar instância de Intl.DateTimeFormat — instanciação é custosa.
// Chamado por dia, não por minuto.
const dateTimeFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  weekday: 'short',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
});

/** Hora, dia, mês, ano e dia da semana de um instante, lidos no fuso da escola. */
function localParts(
  at: Date,
): {
  weekday: number;
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} {
  const parts = dateTimeFormatter.formatToParts(at);
  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? '';

  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };

  return {
    weekday: weekdayMap[get('weekday')] ?? 0,
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')),
    minute: Number(get('minute')),
    second: Number(get('second')),
  };
}

/** Verdadeiro dentro de seg–sex, 07:00–19:00, no fuso da escola. */
export function isWithinBusinessHours(at: Date): boolean {
  const { weekday, hour, minute } = localParts(at);
  if (weekday === 0 || weekday === 6) return false;
  const minuteOfDay = hour * 60 + minute;
  return (
    minuteOfDay >= OPEN_HOUR * 60 && minuteOfDay < CLOSE_HOUR * 60
  );
}

/**
 * Minutos de expediente decorridos entre `from` e `to`.
 *
 * O relógio PAUSA fora da janela: uma mensagem de sexta às 18:50
 * acumula 10 minutos na sexta e só volta a contar segunda às 07:00 —
 * reflete o tempo de atendimento realmente devido, não o de calendário.
 *
 * Implementação por aritmética de dia em America/Sao_Paulo. Para cada
 * dia civil que intersecta [from, to], se for dia útil (seg–sex):
 *
 * 1. Calcula os instantes UTC de abertura (07:00) e fechamento (19:00)
 *    do dia no fuso da escola.
 * 2. Brasil aboliu horário de verão em 2019 — America/Sao_Paulo é
 *    UTC−3 fixo (offset constante, sem transições). Portanto:
 *    - Abertura: 07:00 SP = 10:00 UTC = Date.UTC(y, m−1, d, 10, 0)
 *    - Fechamento: 19:00 SP = 22:00 UTC = Date.UTC(y, m−1, d, 22, 0)
 * 3. Calcula a interseção em milissegundos entre [from, to] e o período
 *    de abertura/fechamento do dia.
 * 4. Acumula milissegundos e converte para minutos no final.
 *
 * Complexidade: O(dias), não O(minutos). Mesmo um intervalo de semanas
 * são poucos dias iterados. A conversão final em milissegundos corrige
 * automaticamente o overcounting de sub-minuto.
 */
export function businessMinutesBetween(from: Date, to: Date): number {
  if (to <= from) return 0;

  let totalMillis = 0;

  // Extrair data inicial em America/Sao_Paulo e criar meia-noite SP em UTC.
  // América/São Paulo é UTC−3 fixo: meia-noite SP = 03:00 UTC.
  const startParts = localParts(from);
  let currentDate = new Date(
    Date.UTC(startParts.year, startParts.month - 1, startParts.day, 3, 0, 0),
  );

  // Iterar dia a dia até ultrapassar `to`.
  while (currentDate < to) {
    const dayParts = localParts(currentDate);

    // Verificar se é dia útil (seg–sex, weekday 1–5).
    if (dayParts.weekday >= 1 && dayParts.weekday <= 5) {
      // Instantes UTC de abertura (07:00) e fechamento (19:00) neste dia.
      // América/São Paulo é UTC−3 fixo: 07:00 = 10:00 UTC, 19:00 = 22:00 UTC.
      const dayOpen = new Date(
        Date.UTC(dayParts.year, dayParts.month - 1, dayParts.day, 10, 0, 0),
      );
      const dayClose = new Date(
        Date.UTC(dayParts.year, dayParts.month - 1, dayParts.day, 22, 0, 0),
      );

      // Interseção de [dayOpen, dayClose] ∩ [from, to] em milissegundos.
      const overlapStart = Math.max(from.getTime(), dayOpen.getTime());
      const overlapEnd = Math.min(to.getTime(), dayClose.getTime());

      if (overlapStart < overlapEnd) {
        totalMillis += overlapEnd - overlapStart;
      }
    }

    // Avançar um dia.
    currentDate.setUTCDate(currentDate.getUTCDate() + 1);
  }

  // Converter milissegundos para minutos (arredonda para baixo).
  return Math.floor(totalMillis / 60000);
}

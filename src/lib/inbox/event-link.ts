// ============================================================
// Link do Google Agenda pra um evento criado no composer da Inbox.
//
// Sem OAuth: em vez de uma integração de verdade com a API do Google
// Calendar, usa o formato de link público `render?action=TEMPLATE`,
// que abre a agenda de QUEM CLICOU já preenchida — a pessoa confirma
// e salva do lado dela. Cobre o caso pedido (usuário criador lança na
// própria agenda) sem nenhuma credencial, conexão por conta, ou
// renovação de token. Ver docs/superpowers/specs — decisão tomada em
// 2026-09-21 depois de descartar o desenho com OAuth completo.
// ============================================================

export interface EventDetails {
  title: string;
  /** "YYYY-MM-DDTHH:mm" (o formato de <input type="date"> + type="time">
   *  combinados), sempre interpretado como horário de Brasília
   *  (America/Sao_Paulo, UTC-3 fixo desde o fim do horário de verão em
   *  2019 — mesma premissa de src/lib/dashboard/business-hours.ts). */
  startLocal: string;
  /** Ausente = evento de 1h a partir do início. */
  endLocal?: string;
  location?: string;
}

const SAO_PAULO_UTC_OFFSET_HOURS = 3;
const DEFAULT_DURATION_MS = 60 * 60 * 1000;

/** "YYYY-MM-DDTHH:mm" em horário de Brasília -> instante UTC real.
 *  `Date.UTC` normaliza hora/dia fora de alcance sozinho (ex.: hora 25
 *  vira +1 dia), então somar o offset não precisa de aritmética de
 *  virada de dia manual. */
function saoPauloLocalToUtc(local: string): Date {
  const [datePart, timePart] = local.split("T");
  const [year, month, day] = datePart.split("-").map(Number);
  const [hour, minute] = timePart.split(":").map(Number);
  return new Date(Date.UTC(year, month - 1, day, hour + SAO_PAULO_UTC_OFFSET_HOURS, minute, 0));
}

/** UTC -> "YYYYMMDDTHHMMSSZ", o formato que o Google exige no parâmetro `dates`. */
function formatGoogleUtc(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  );
}

export function buildGoogleCalendarLink(event: EventDetails): string {
  const start = saoPauloLocalToUtc(event.startLocal);
  const end = event.endLocal
    ? saoPauloLocalToUtc(event.endLocal)
    : new Date(start.getTime() + DEFAULT_DURATION_MS);

  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: event.title,
    dates: `${formatGoogleUtc(start)}/${formatGoogleUtc(end)}`,
  });
  if (event.location) params.set("location", event.location);

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/** "YYYY-MM-DDTHH:mm" -> "25/09/2026 às 14:00", sem depender de
 *  Intl/timezone do runtime — os dois lados já são o mesmo horário de
 *  Brasília que o usuário digitou, só reformatados. */
function formatEventDateTimePtBR(local: string): string {
  const [datePart, timePart] = local.split("T");
  const [year, month, day] = datePart.split("-");
  return `${day}/${month}/${year} às ${timePart}`;
}

/** Texto da mensagem opcional enviada ao contato pelo WhatsApp. */
export function buildEventWhatsAppMessage(event: EventDetails): string {
  const lines = [
    `*${event.title}*`,
    formatEventDateTimePtBR(event.startLocal),
  ];
  if (event.location) lines.push(event.location);
  return lines.join("\n");
}

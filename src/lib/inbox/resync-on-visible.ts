/**
 * Quanto tempo a aba precisa ficar escondida para valer recarregar a
 * Inbox ao voltar. Cada recarga baixa a lista de conversas inteira
 * (~1,1 MB) — recarregar a cada troca de aba multiplicava isso pelo vai
 * e vem entre WhatsApp e CRM o dia todo. Escondida por pouco tempo, a
 * aba continua recebendo o tempo real; 5 minutos é também quando o
 * Chrome passa a estrangular timers de aba em segundo plano, o que pode
 * derrubar o heartbeat do canal. Reconexão do canal tem gatilho próprio.
 */
export const RESYNC_AFTER_HIDDEN_MS = 5 * 60_000;

/** `hiddenAt`: epoch (ms) de quando a aba foi escondida; null se não houve. */
export function shouldResyncOnVisible(hiddenAt: number | null, now: number): boolean {
  if (hiddenAt === null) return false;
  return now - hiddenAt >= RESYNC_AFTER_HIDDEN_MS;
}

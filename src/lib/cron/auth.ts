// ============================================================
// Autenticação compartilhada das rotas de cron.
//
// Existe porque a Vercel Cron NÃO permite header customizado: ela
// sempre chama o endpoint com `Authorization: Bearer $CRON_SECRET`.
// As rotas originais só aceitavam `x-cron-secret`, então nenhuma delas
// poderia ser agendada pela cron nativa. Aqui os dois formatos são
// aceitos — o Bearer para a Vercel, o header antigo para qualquer
// pinger externo que já exista.
// ============================================================

import { timingSafeEqual } from 'node:crypto';

/**
 * Compara em tempo constante para que quem consegue chamar o endpoint
 * não recupere o segredo byte a byte medindo o tempo de resposta. A
 * pré-checagem de tamanho é exigida por `timingSafeEqual` (que lança
 * com buffers de tamanhos diferentes) e vaza apenas o comprimento, que
 * não é sensível.
 */
function secretMatches(supplied: string, expected: string): boolean {
  const suppliedBuf = Buffer.from(supplied);
  const expectedBuf = Buffer.from(expected);
  if (suppliedBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(suppliedBuf, expectedBuf);
}

/**
 * `true` apenas quando a requisição traz o segredo correto em um dos
 * dois formatos aceitos. Sem segredo provisionado o resultado é sempre
 * `false`: um endpoint de varredura sem credencial precisa ficar
 * fechado, nunca aberto.
 */
export function isAuthorizedCronRequest(
  request: Request,
  expected: string | undefined,
): boolean {
  if (!expected) return false;

  const bearer = request.headers.get('authorization') ?? '';
  if (bearer.startsWith('Bearer ')) {
    if (secretMatches(bearer.slice('Bearer '.length), expected)) return true;
  }

  const custom = request.headers.get('x-cron-secret') ?? '';
  return secretMatches(custom, expected);
}

/**
 * Segredo esperado. `CRON_SECRET` é o nome que a Vercel Cron usa por
 * convenção; `AUTOMATION_CRON_SECRET` continua valendo para não quebrar
 * um ambiente que já o tenha provisionado.
 */
export function cronSecret(): string | undefined {
  return process.env.CRON_SECRET || process.env.AUTOMATION_CRON_SECRET;
}
